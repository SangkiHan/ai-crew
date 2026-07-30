export type TicketStatus =
  | "queued"
  | "assigned"
  | "running"
  | "review"
  | "blocked"
  | "needs_approval"
  | "done"
  | "failed";

export type AgentRole = "manager" | "backend" | "frontend" | "docs";

export interface Ticket {
  id: string;
  role: AgentRole;
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
}

export const TICKET_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  queued: ["assigned", "failed"],
  assigned: ["running", "failed"],
  running: ["review", "blocked", "needs_approval", "failed"],
  review: ["done", "failed", "running"],
  blocked: ["queued", "failed"],
  needs_approval: ["running", "failed"],
  done: [],
  failed: [],
};

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return TICKET_TRANSITIONS[from].includes(to);
}
