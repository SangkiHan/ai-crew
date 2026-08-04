import { execFile } from "node:child_process";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import spawn from "cross-spawn";
import type { Employee, RunnerToServerEvent, Ticket } from "@ai-crew/shared";
import { prepareEmployeeJob, reportDriverResult } from "../employees/prepare.js";

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const EMPLOYEE_MCP_SERVER_ENTRY =
  process.env.EMPLOYEE_MCP_SERVER_ENTRY ?? join(REPO_ROOT, "apps", "server", "dist", "mcp", "employee-server.js");
const AI_CREW_SERVER_URL = process.env.AI_CREW_SERVER_URL ?? "http://localhost:8080";
const EMPLOYEE_MCP_SERVER_NAME = "ai-crew-employee-tools";

// Antigravity CLI(agy)의 워크스페이스 MCP 설정 경로는 .agents/mcp_config.json이다.
// 포맷은 Gemini CLI 계열의 {mcpServers: {...}}를 그대로 쓴다 (agy가 Gemini CLI의 후속이라
// 설정 스키마를 승계함). 티켓마다 env가 달라야 하므로 매 실행 전에 덮어쓴다.
async function writeWorkspaceMcpConfig(
  cwd: string,
  ticketId: string,
  employeeName: string,
  teamId: string
): Promise<void> {
  const agentsDir = join(cwd, ".agents");
  await mkdir(agentsDir, { recursive: true });
  const settings = {
    mcpServers: {
      [EMPLOYEE_MCP_SERVER_NAME]: {
        command: "node",
        args: [EMPLOYEE_MCP_SERVER_ENTRY],
        env: { TICKET_ID: ticketId, EMPLOYEE_NAME: employeeName, TEAM_ID: teamId, AI_CREW_SERVER_URL },
      },
    },
  };
  await writeFile(join(agentsDir, "mcp_config.json"), JSON.stringify(settings, null, 2), "utf-8");
}

// agy는 워크스페이스 컨텍스트로 GEMINI.md와 AGENTS.md 둘 다 읽는다. 우리는 GEMINI.md를 쓴다 -
// AGENTS.md는 여러 에이전트가 공유하는 표준 파일이라 대상 프로젝트에 이미 존재할 수 있고,
// 직원 프롬프트로 덮어썼다가는 프로젝트의 원래 지침을 날려버린다. GEMINI.md와
// .agents/(호스트 절대경로 포함)는 절대 커밋되면 안 되므로 git의 로컬 전용 exclude에 등록한다
// (프로젝트의 실제 .gitignore는 건드리지 않음).
async function writeContextFile(cwd: string, systemPrompt: string): Promise<void> {
  await writeFile(join(cwd, "GEMINI.md"), systemPrompt, "utf-8");
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, "rev-parse", "--git-path", "info/exclude"]);
    const excludePath = join(cwd, stdout.trim());
    await appendFile(excludePath, "\nGEMINI.md\n.agents/\n");
  } catch {
    // exclude 등록에 실패해도 작업 자체는 계속 진행한다 - 최선노력.
  }
}

// 실제 Antigravity CLI(agy) 직원. Gemini CLI(2026-06-18 종료)의 후속 드라이버다.
// - agy -p는 stream-json 같은 구조화 출력 옵션이 없어서, stdout 텍스트를 그대로 로그로 흘리고
//   성공/실패는 종료 코드(0=성공)로만 판단한다.
// - Gemini CLI의 사용자 레벨 deny 정책(~/.gemini/policies) 같은 requireApproval 차단 수단이
//   agy에는 확인되지 않아 제공하지 않는다 - requireApproval을 신뢰성 있게 막는 건 claude
//   드라이버뿐이라는 기존 한계가 여기서도 이어진다.
// - --conversation(대화 id 재개)은 있지만 id를 사전 지정할 수 없어 revise(세션 이어가기)는
//   미지원이다 (Gemini CLI 때와 동일).
export async function runAntigravityDriver(
  ticket: Ticket,
  employee: Employee,
  send: (event: RunnerToServerEvent) => void
) {
  const { cwd, message, systemPrompt } = await prepareEmployeeJob(ticket, employee, send);
  const now = () => new Date().toISOString();

  await writeWorkspaceMcpConfig(cwd, ticket.id, employee.name, employee.teamId);
  await writeContextFile(cwd, systemPrompt);

  const args = [
    "-p",
    message,
    // 자율 실행: 승인 프롬프트에서 멈추면 headless 세션이 영영 대기한다.
    "--dangerously-skip-permissions",
    // -p의 기본 대기 시간이 5분이라 티켓 작업 대부분이 중간에 잘린다. Go duration 형식.
    "--print-timeout",
    "120m",
    ...(employee.model ? ["--model", employee.model] : []),
  ];

  let stdoutTail = "";
  const success = await new Promise<boolean>((resolve) => {
    const child = spawn("agy", args, { cwd });

    let buffer = "";
    let stderr = "";

    child.stdout!.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      // 팀장 보고(resultText)용으로 마지막 출력을 보관한다 - agy -p의 최종 응답은 stdout으로 나온다.
      stdoutTail = (stdoutTail + text).slice(-4000);
      buffer += text;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        send({ type: "job_log", ticketId: ticket.id, line: `[agy] ${line}`, ts: now() });
        send({ type: "job_heartbeat", ticketId: ticket.id, ts: now() });
      }
    });

    child.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      send({
        type: "job_log",
        ticketId: ticket.id,
        line: `[agy] 실행 실패: ${err.message} (Antigravity CLI가 설치되어 있는지 확인하세요)`,
        ts: now(),
      });
      resolve(false);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        send({
          type: "job_log",
          ticketId: ticket.id,
          line: `[agy] 비정상 종료 (code ${code}): ${stderr || "(stderr 없음)"}`,
          ts: now(),
        });
      }
      resolve(code === 0);
    });
  });

  reportDriverResult(ticket, employee, { success, resultText: stdoutTail.trim(), sessionId: undefined }, send);
}
