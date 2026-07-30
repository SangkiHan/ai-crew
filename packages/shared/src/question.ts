export type QuestionStatus = "open" | "answered";

export interface Question {
  id: string;
  text: string;
  status: QuestionStatus;
  answer: string | null;
  createdAt: string;
  updatedAt: string;
}
