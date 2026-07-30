export type PlanningDocStatus = "drafting" | "review" | "approved" | "rejected";

// 채팅의 "기획" 모드로 요청하면 만들어지는 서비스 기획서. 사람이 승인하면 그 내용을 바탕으로
// 팀장이 실제 개발 티켓들을 발행한다.
export interface PlanningDoc {
  id: string;
  teamId: string;
  employeeName: string;
  request: string;
  content: string | null;
  status: PlanningDocStatus;
  // 기획자와의 대화(티키타카)를 이어가기 위한 세션 id. 수정 요청을 보내면 이 세션을 이어서
  // 새 초안을 쓴다.
  sessionId: string | null;
  createdAt: string;
  updatedAt: string;
}
