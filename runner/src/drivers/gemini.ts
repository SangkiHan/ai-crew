import { randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Employee, RunnerToServerEvent, Ticket } from "@ai-crew/shared";
import { prepareEmployeeJob, reportDriverResult } from "../employees/prepare.js";

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const EMPLOYEE_MCP_SERVER_ENTRY =
  process.env.EMPLOYEE_MCP_SERVER_ENTRY ?? join(REPO_ROOT, "apps", "server", "dist", "mcp", "employee-server.js");
const AI_CREW_SERVER_URL = process.env.AI_CREW_SERVER_URL ?? "http://localhost:8080";
const EMPLOYEE_MCP_SERVER_NAME = "ai-crew-employee-tools";

// Gemini CLI의 워크스페이스(프로젝트) 레벨 정책 엔진은 현재 비활성 상태라(.gemini/policies 무시됨),
// requireApproval을 확실히 차단하지 못한다. 대신 사용자 레벨 정책 파일에 deny 규칙을 써서
// best-effort로 막는다 - claude의 --disallowedTools만큼 신뢰할 수 없다는 걸 문서화해둔다.
async function writeBestEffortDenyPolicy(requireApproval: string[]): Promise<void> {
  if (requireApproval.length === 0) return;
  const policiesDir = join(homedir(), ".gemini", "policies");
  await mkdir(policiesDir, { recursive: true });
  const rules = requireApproval
    .map(
      (cmd) => `[[rule]]
toolName = "run_shell_command"
commandPrefix = "${cmd}"
decision = "deny"
priority = 999
`
    )
    .join("\n");
  await writeFile(join(policiesDir, "ai-crew.toml"), rules, "utf-8");
}

async function writeProjectMcpSettings(worktreePath: string, ticketId: string, employeeName: string): Promise<void> {
  const geminiDir = join(worktreePath, ".gemini");
  await mkdir(geminiDir, { recursive: true });
  const settings = {
    mcpServers: {
      [EMPLOYEE_MCP_SERVER_NAME]: {
        command: "node",
        args: [EMPLOYEE_MCP_SERVER_ENTRY],
        env: { TICKET_ID: ticketId, EMPLOYEE_NAME: employeeName, AI_CREW_SERVER_URL },
      },
    },
  };
  await writeFile(join(geminiDir, "settings.json"), JSON.stringify(settings, null, 2), "utf-8");
}

// GEMINI_SYSTEM_MD는 파일 경로를 받아 기본 시스템 프롬프트를 "완전히" 대체해버려서
// (안전/도구사용 관련 기본 지침까지 사라짐) 위험하다. 대신 GEMINI.md는 기존 시스템 프롬프트에
// 컨텍스트로 추가되는 표준 방식이라 여기에 직원 프롬프트를 쓴다 (CLAUDE.md와 같은 성격).
// GEMINI.md와 .gemini/settings.json(호스트 절대경로 포함)은 절대 커밋되면 안 되므로
// git의 로컬 전용 exclude에 등록해둔다 (프로젝트의 실제 .gitignore는 건드리지 않음).
async function writeGeminiContextFile(worktreePath: string, systemPrompt: string): Promise<void> {
  await writeFile(join(worktreePath, "GEMINI.md"), systemPrompt, "utf-8");
  try {
    const { stdout } = await execFileAsync("git", ["-C", worktreePath, "rev-parse", "--git-path", "info/exclude"]);
    const excludePath = join(worktreePath, stdout.trim());
    await appendFile(excludePath, "\nGEMINI.md\n.gemini/\n");
  } catch {
    // exclude 등록에 실패해도 작업 자체는 계속 진행한다 - 최선노력.
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function summarizeEvent(event: any): string | null {
  if (event.type === "init") return `[gemini] 세션 시작 (model: ${event.model ?? "?"})`;
  if (event.type === "tool_use") return `[gemini] tool: ${event.tool_name ?? event.toolName ?? "?"}`;
  if (event.type === "message" && typeof event.text === "string" && event.text.trim() && !event.delta) {
    return `[gemini] ${event.text.trim()}`;
  }
  if (event.type === "error") return `[gemini] 에러: ${event.message ?? JSON.stringify(event)}`;
  if (event.type === "result") return `[gemini] 종료`;
  return null;
}

// 실제 Gemini CLI 직원. Gemini CLI의 정확한 stream-json 필드명은 공식 문서에도 완전히
// 명시되어 있지 않아, 성공/실패 판단은 문서화된 종료 코드(0=성공)를 기준으로 하고
// JSON 파싱은 진행상황을 보여주는 최선노력으로만 쓴다 (모르는 필드가 와도 죽지 않는다).
export async function runGeminiDriver(
  ticket: Ticket,
  employee: Employee,
  send: (event: RunnerToServerEvent) => void
) {
  const { worktreePath, message, systemPrompt } = await prepareEmployeeJob(ticket, employee, send);
  const now = () => new Date().toISOString();

  await writeProjectMcpSettings(worktreePath, ticket.id, employee.name);
  await writeGeminiContextFile(worktreePath, systemPrompt);
  await writeBestEffortDenyPolicy(employee.requireApproval);

  const sessionId = randomUUID();
  const args = [
    "-p",
    message,
    "-o",
    "stream-json",
    "--approval-mode",
    "yolo",
    "--skip-trust",
    "--session-id",
    sessionId,
    ...(employee.model ? ["-m", employee.model] : []),
  ];

  const success = await new Promise<boolean>((resolve) => {
    const child = spawn("gemini", args, { cwd: worktreePath });

    let buffer = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          const summary = summarizeEvent(event);
          if (summary) {
            send({ type: "job_log", ticketId: ticket.id, line: summary, ts: now() });
            send({ type: "job_heartbeat", ticketId: ticket.id, ts: now() });
          }
        } catch {
          // stream-json이 아닌 일반 로그 라인일 수 있다 - 그냥 흘려보낸다.
          send({ type: "job_log", ticketId: ticket.id, line: `[gemini] ${line}`, ts: now() });
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      send({ type: "job_log", ticketId: ticket.id, line: `[gemini] 실행 실패: ${err.message}`, ts: now() });
      resolve(false);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        send({
          type: "job_log",
          ticketId: ticket.id,
          line: `[gemini] 비정상 종료 (code ${code}): ${stderr || "(stderr 없음)"}`,
          ts: now(),
        });
      }
      resolve(code === 0);
    });
  });

  reportDriverResult(ticket, employee, { success, resultText: "", sessionId }, send);
}
