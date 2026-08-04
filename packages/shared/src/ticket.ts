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
  // 이 티켓이 실제로 작업된 프로젝트의 그 시점 브랜치 이름(작업 시작 시 캡처). 격리된 워크트리/
  // 새 브랜치 없이 프로젝트 실제 폴더의 현재 브랜치에 직접 작업하므로, 참고용으로만 남긴다.
  branch: string | null;
  // 작업 시작 시점의 HEAD 커밋. diffSummary(실제 커밋 여부 확인)를 계산하는 기준점이다.
  baseSha: string | null;
  createdAt: string;
  updatedAt: string;
  lastHeartbeatAt: string | null;
  // QA 직원이 이 티켓을 몇 번 반려했는지. 3회 넘으면 needs_approval로 escalate한다.
  qaCycles: number;
  // 팀장이 티켓 생성 시 정한 QA 검증 필요 여부 - false면 QA 직원이 있어도 검증을 건너뛴다.
  needsQa: boolean;
  // QA가 남긴 가장 최근 반려 사유.
  qaNote: string | null;
  // 직원 세션의 최종 보고 텍스트. 커밋을 했든 안 했든 항상 채워진다 - 검수 화면에서 raw 로그
  // 대신 바로 보여준다.
  resultText: string | null;
  // 이 티켓 브랜치의 실제 커밋 요약. null이면 아직 계산 전(진행 중), 빈 커밋이면 그 사실이
  // 문자열로 명시된다 - 승인 전에 "정말 반영할 코드가 있는지" 사람이 확인할 수 있게 한다.
  diffSummary: string | null;
  retryAt: string | null;
  retryReason: string | null;
  retryCount: number;
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
  failed: ["queued"],
};

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return TICKET_TRANSITIONS[from].includes(to);
}
