import type { Employee, RunnerToServerEvent, Ticket } from "@ai-crew/shared";
import { createWorktree } from "../worktree.js";
import { projectPath } from "../workspace.js";
import { fetchPendingPeerMessages } from "./api.js";
import { buildEmployeePrompt, formatPendingPeerMessages } from "./prompt.js";

export interface PreparedJob {
  worktreePath: string;
  message: string;
  systemPrompt: string;
}

function toDisallowedBashPatterns(requireApproval: string[]): string[] {
  return requireApproval.map((cmd) => `Bash(${cmd}:*)`);
}

// claude/gemini/codex 드라이버가 공유하는 준비 단계: worktree 생성, 미답변 동료 메시지 포함,
// 시스템 프롬프트 생성. CLI마다 실제 spawn 방식/플래그만 다르다.
export async function prepareEmployeeJob(
  ticket: Ticket,
  employee: Employee,
  send: (event: RunnerToServerEvent) => void
): Promise<PreparedJob> {
  const now = () => new Date().toISOString();

  if (ticket.status === "assigned") {
    send({ type: "job_status", ticketId: ticket.id, status: "running" });
  }

  const { worktreePath } = await createWorktree(projectPath(ticket.project), ticket.project, ticket.id);
  send({ type: "job_meta", ticketId: ticket.id, worktreePath });
  send({
    type: "job_log",
    ticketId: ticket.id,
    line: `[${employee.name}] worktree 준비 완료: ${worktreePath}`,
    ts: now(),
  });

  const pendingPeerMessages = await fetchPendingPeerMessages(employee.name).catch(() => []);
  const message = `## 티켓: ${ticket.title}\n\n${ticket.spec}${formatPendingPeerMessages(pendingPeerMessages)}`;

  return { worktreePath, message, systemPrompt: buildEmployeePrompt(employee.taskDescription) };
}

export interface DriverResult {
  success: boolean;
  resultText: string;
  sessionId?: string;
}

export function reportDriverResult(
  ticket: Ticket,
  employee: Employee,
  result: DriverResult,
  send: (event: RunnerToServerEvent) => void
) {
  const now = () => new Date().toISOString();

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
      line: `[${employee.name}] 실패: ${result.resultText || "(사유 없음)"}`,
      ts: now(),
    });
    send({ type: "job_status", ticketId: ticket.id, status: "failed" });
  }
}

export { toDisallowedBashPatterns };
