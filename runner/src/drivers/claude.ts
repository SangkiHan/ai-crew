import type { AgentConfig, RunnerToServerEvent, Ticket } from "@ai-crew/shared";
import { runClaudeHeadless } from "../claude/headless.js";
import { createWorktree } from "../worktree.js";
import { projectPath } from "../workspace.js";

function toDisallowedTools(requireApproval: string[]): string[] {
  return requireApproval.map((cmd) => `Bash(${cmd}:*)`);
}

// 실제 Claude Code 직원. git worktree 안에서 티켓 spec을 그대로 지시문으로 넘기고,
// agents/*.md의 allowedTools는 허용하되 requireApproval에 있는 명령은 Bash 패턴으로 차단한다.
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
    allowedTools: agent.allowedTools,
    disallowedTools: toDisallowedTools(agent.requireApproval),
    permissionMode: "acceptEdits",
    cwd: worktreePath,
    onEvent: (line) => {
      send({ type: "job_log", ticketId: ticket.id, line, ts: now() });
      send({ type: "job_heartbeat", ticketId: ticket.id, ts: now() });
    },
  });

  if (result.sessionId) {
    send({ type: "job_meta", ticketId: ticket.id, sessionId: result.sessionId });
  }

  if (result.success) {
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
