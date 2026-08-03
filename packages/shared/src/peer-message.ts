export type PeerMessageStatus = "open" | "answered";

export interface PeerMessage {
  id: string;
  // 이 대화가 오간 팀. 직원 이름은 팀 안에서만 유일해서 이름만으로는 누구인지 특정되지 않는다.
  // 이 필드가 생기기 전에 오간 질문은 null이다.
  teamId: string | null;
  fromName: string;
  toName: string;
  question: string;
  answer: string | null;
  status: PeerMessageStatus;
  createdAt: string;
  updatedAt: string;
}
