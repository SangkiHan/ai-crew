import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentConfig, RunnerToServerEvent, Ticket } from "@ai-crew/shared";
import { runClaudeHeadless } from "../claude/headless.js";
import { createWorktree } from "../worktree.js";
import { projectPath } from "../workspace.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", ".."); // drivers -> src -> runner -> repo root
const EMPLOYEE_MCP_SERVER_ENTRY =
  process.env.EMPLOYEE_MCP_SERVER_ENTRY ?? join(REPO_ROOT, "apps", "server", "dist", "mcp", "employee-server.js");
const AI_CREW_SERVER_URL = process.env.AI_CREW_SERVER_URL ?? "http://localhost:8080";

const EMPLOYEE_MCP_SERVER_NAME = "ai-crew-employee-tools";
const REPORT_BLOCKED_TOOL = `mcp__${EMPLOYEE_MCP_SERVER_NAME}__report_blocked`;

function toDisallowedTools(requireApproval: string[]): string[] {
  return requireApproval.map((cmd) => `Bash(${cmd}:*)`);
}

function buildEmployeeMcpConfig(ticketId: string): string {
  return JSON.stringify({
    mcpServers: {
      [EMPLOYEE_MCP_SERVER_NAME]: {
        type: "stdio",
        command: "node",
        args: [EMPLOYEE_MCP_SERVER_ENTRY],
        env: { TICKET_ID: ticketId, AI_CREW_SERVER_URL },
      },
    },
  });
}

// 실제 Claude Code 직원. git worktree 안에서 티켓 spec을 그대로 지시문으로 넘기고,
// agents/*.md의 allowedTools는 허용하되 requireApproval에 있는 명령은 Bash 패턴으로 차단한다.
// report_blocked MCP 툴을 붙여서, 막히면 직접 다른 프로젝트를 건드리지 않고 팀장에게 에스컬레이션한다.
export async function runClaudeDriver(
  ticket: Ticket,
  agent: AgentConfig,
  send: (event: RunnerToServerEvent) => void
) {
  const now = () => new Date().toISOString();

  if (ticket.status === "assigned") {
    send({ type: "job_status", ticketId: ticket.id, status: "running" });
  }

  const { worktreePath } = await createWorktree(projectPath(ticket.project), ticket.project, ticket.id);
  send({ type: "job_meta", ticketId: ticket.id, worktreePath });
  send({
    type: "job_log",
    ticketId: ticket.id,
    line: `[${agent.name}] worktree 준비 완료: ${worktreePath}`,
    ts: now(),
  });

  const message = `## 티켓: ${ticket.title}\n\n${ticket.spec}`;

  const result = await runClaudeHeadless({
    message,
    systemPrompt: agent.prompt,
    allowedTools: [...agent.allowedTools, REPORT_BLOCKED_TOOL],
    disallowedTools: toDisallowedTools(agent.requireApproval),
    permissionMode: "acceptEdits",
    cwd: worktreePath,
    mcpConfigJson: buildEmployeeMcpConfig(ticket.id),
    onEvent: (line) => {
      send({ type: "job_log", ticketId: ticket.id, line, ts: now() });
      send({ type: "job_heartbeat", ticketId: ticket.id, ts: now() });
    },
  });

  if (result.sessionId) {
    send({ type: "job_meta", ticketId: ticket.id, sessionId: result.sessionId });
  }

  if (result.success) {
    // report_blocked를 이미 호출했다면 티켓은 REST 경로로 곧장 "blocked"가 되어 있고,
    // 여기서 "review"로 보내려는 시도는 유효하지 않은 전이라 서버에서 조용히 거부된다.
    send({ type: "job_status", ticketId: ticket.id, status: "review" });
  } else {
    send({
      type: "job_log",
      ticketId: ticket.id,
      line: `[${agent.name}] 실패: ${result.resultText || "(사유 없음)"}`,
      ts: now(),
    });
    send({ type: "job_status", ticketId: ticket.id, status: "failed" });
  }
}
