import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import spawn from "cross-spawn";
import type { Employee, RunnerToServerEvent, Ticket } from "@ai-crew/shared";
import {
  clearDriverPid,
  prepareEmployeeJob,
  reportDriverResult,
  toDisallowedBashPatterns,
  writeDriverPid,
} from "../employees/prepare.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", ".."); // drivers -> src -> runner -> repo root
const EMPLOYEE_MCP_SERVER_NAME = "ai-crew-employee-tools";

function buildMcpConfigFlags(
  entry: string,
  serverUrl: string,
  ticketId: string,
  employeeName: string,
  teamId: string
): string[] {
  const prefix = `mcp_servers.${EMPLOYEE_MCP_SERVER_NAME}`;
  // Windows 경로는 백슬래시를 쓰는데 TOML 문자열에서 백슬래시는 이스케이프 문자다.
  // 슬래시로 바꿔도 Windows/Node 양쪽에서 경로로 잘 인식된다.
  const safeEntry = entry.replace(/\\/g, "/");
  return [
    "-c",
    `${prefix}.command="node"`,
    "-c",
    `${prefix}.args=["${safeEntry}"]`,
    "-c",
    `${prefix}.env.TICKET_ID="${ticketId}"`,
    "-c",
    `${prefix}.env.EMPLOYEE_NAME="${employeeName}"`,
    "-c",
    `${prefix}.env.TEAM_ID="${teamId}"`,
    "-c",
    `${prefix}.env.AI_CREW_SERVER_URL="${serverUrl}"`,
  ];
}

// codex의 sandbox 정책은 claude/gemini의 permission-mode와 결이 달라서(허용 명령을 개별
// 지정하는 게 아니라 read-only/workspace-write/danger-full-access 3단계), requireApproval을
// 세밀하게 차단할 방법이 없다. workspace-write로 워크트리 밖 파괴적 작업만 막는다.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function summarizeEvent(event: any): string | null {
  if (event.type === "thread.started") return `[codex] 세션 시작`;
  if (event.type === "item.completed" && event.item?.type === "agent_message") {
    const text = event.item.text ?? event.item.content;
    return text ? `[codex] ${text}` : null;
  }
  if (event.item?.type === "command_execution") return `[codex] tool: ${event.item.command ?? "shell"}`;
  if (event.item?.type === "mcp_tool_call") return `[codex] tool: ${event.item.tool ?? event.item.server ?? "mcp"}`;
  if (event.type === "turn.failed") return `[codex] 실패: ${JSON.stringify(event.error ?? event)}`;
  return null;
}

// 실제 Codex CLI 직원. `codex exec --json`의 JSONL 필드명도 공식 문서가 완전하지 않아서
// 진행상황 로그는 최선노력이고, 성공/실패는 문서화된 종료 코드를 기준으로 판단한다.
// 참고: Codex의 헤드리스 실행은 보통 API 키 인증을 기대한다 (ChatGPT OAuth는 대화형 전용일 수
// 있음) - 실제로는 사용자가 `codex login` 이후 직접 확인이 필요하다.
export async function runCodexDriver(
  ticket: Ticket,
  employee: Employee,
  send: (event: RunnerToServerEvent) => void
) {
  const { cwd, message, systemPrompt } = await prepareEmployeeJob(ticket, employee, send);
  const now = () => new Date().toISOString();

  const EMPLOYEE_MCP_SERVER_ENTRY =
    process.env.EMPLOYEE_MCP_SERVER_ENTRY ??
    join(REPO_ROOT, "apps", "server", "dist", "mcp", "employee-server.js");
  const AI_CREW_SERVER_URL = process.env.AI_CREW_SERVER_URL ?? "http://localhost:8080";

  const sessionId = randomUUID();
  const fullPrompt = `${systemPrompt}\n\n${message}`;
  const args = [
    "exec",
    fullPrompt,
    "--json",
    "-C",
    cwd,
    "-s",
    "workspace-write",
    "--skip-git-repo-check",
    // 직원 실행은 Codex의 전역 세션/SQLite 상태를 공유할 필요가 없다. 다른 Codex 세션이
    // 실행 중이어도 전역 잠금 때문에 headless 작업이 시작 단계에서 멈추지 않도록 한다.
    "--ephemeral",
    ...(employee.model ? ["-m", employee.model] : []),
    ...buildMcpConfigFlags(EMPLOYEE_MCP_SERVER_ENTRY, AI_CREW_SERVER_URL, ticket.id, employee.name, employee.teamId),
  ];
  void toDisallowedBashPatterns; // codex sandbox 모델에는 이 패턴을 적용할 자리가 없다 (위 주석 참고)

  let failureText = "";
  const success = await new Promise<boolean>((resolve) => {
    const child = spawn("codex", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    writeDriverPid(ticket.id, child.pid).catch(() => {});

    let buffer = "";
    let stderr = "";
    let settled = false;
    const startupTimeout = setTimeout(() => {
      if (settled) return;
      const message = "[codex] 60초 동안 시작 이벤트가 없어 실행을 중단했습니다";
      send({ type: "job_log", ticketId: ticket.id, line: message, ts: now() });
      send({ type: "job_heartbeat", ticketId: ticket.id, ts: now() });
      child.kill();
    }, 60_000);

    const emit = (line: string) => {
      const text = line.trim();
      if (!text) return;
      send({ type: "job_log", ticketId: ticket.id, line: text, ts: now() });
      send({ type: "job_heartbeat", ticketId: ticket.id, ts: now() });
    };

    child.stdout!.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          const summary = summarizeEvent(event);
          emit(summary ?? `[codex] ${event.type ?? "이벤트"}`);
        } catch {
          emit(`[codex] ${line}`);
        }
      }
    });

    child.stderr!.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      failureText = stderr;
      for (const line of text.split(/\r?\n/)) emit(`[codex] stderr: ${line}`);
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(startupTimeout);
      emit(`[codex] 실행 실패: ${err.message}`);
      resolve(false);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(startupTimeout);
      if (code !== 0) {
        emit(`[codex] 비정상 종료 (code ${code}): ${stderr.trim() || "(stderr 없음)"}`);
      }
      resolve(code === 0);
    });
  }).finally(() => clearDriverPid(ticket.id));

  reportDriverResult(ticket, employee, {
    success,
    resultText: success ? "" : failureText.trim(),
    sessionId,
  }, send);
}
