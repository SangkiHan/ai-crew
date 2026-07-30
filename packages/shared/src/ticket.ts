export type TicketStatus =
  | "queued"
  | "assigned"
  | "running"
  | "qa_review"
  | "review"
  | "blocked"
  | "needs_approval"
  | "done"
  | "failed";

export interface Ticket {
  id: string;
  // 이 티켓이 속한 팀. 직원의 팀과 항상 같다 (생성 시 role로 찾은 직원의 teamId를 그대로 쓴다).
  teamId: string;
  // 직원의 이름(Employee.name)과 같다. 직원이 이름 기반으로 자유롭게 추가/삭제되므로 고정 enum이 아니다.
  role: string;
  project: string;
  title: string;
  spec: string;
  status: TicketStatus;
  parentTicketId: string | null;
  sessionId: string | null;
  worktreePath: string | null;
  createdAt: string;
  updatedAt: string;
  lastHeartbeatAt: string | null;
  // QA 직원이 이 티켓을 몇 번 반려했는지. 3회 넘으면 needs_approval로 escalate한다.
  qaCycles: number;
  // QA가 남긴 가장 최근 반려 사유.
  qaNote: string | null;
}

export const TICKET_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  queued: ["assigned", "failed"],
  assigned: ["running", "failed"],
  // running 완료 후: 팀에 QA 직원이 있으면 qa_review로, 없으면 바로 review로 (서버가 결정).
  running: ["qa_review", "review", "blocked", "needs_approval", "failed"],
  // qa_review: QA 통과 -> done(사람 승인 없이 바로 완료+머지 - 기획서 승인이 이미 사람의 확인
  // 지점이라는 전제), 반려(3회 미만) -> running(원래 담당자 재작업), 반려(3회 이상) ->
  // needs_approval(사람에게 계속할지 묻기).
  qa_review: ["done", "running", "needs_approval", "failed"],
  review: ["done", "failed", "running"],
  blocked: ["queued", "failed"],
  needs_approval: ["running", "failed"],
  done: [],
  failed: [],
};

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return TICKET_TRANSITIONS[from].includes(to);
}

// 러너(워크트리 생성)와 서버(머지 요청) 양쪽에서 같은 브랜치명을 계산해야 해서 여기 하나로 둔다.
export function ticketBranchName(ticketId: string): string {
  return `ai-crew/${ticketId}`;
}
