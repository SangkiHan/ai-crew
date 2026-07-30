export type PeerMessageStatus = "open" | "answered";

export interface PeerMessage {
  id: string;
  fromName: string;
  toName: string;
  question: string;
  answer: string | null;
  status: PeerMessageStatus;
  createdAt: string;
  updatedAt: string;
}
