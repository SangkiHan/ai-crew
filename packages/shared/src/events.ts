import type { Ticket } from "./ticket.js";

export type ServerToUiEvent =
  | { type: "ticket_updated"; ticket: Ticket }
  | { type: "log_line"; ticketId: string; line: string; ts: string }
  | { type: "agent_status"; agentId: string; status: "idle" | "busy" }
  | { type: "manager_log"; requestId: string; line: string; ts: string }
  | { type: "manager_result"; requestId: string; resultText: string; success: boolean }
  | { type: "manager_status"; status: "idle" | "busy" };

export type UiToServerEvent =
  | { type: "chat_message"; text: string }
  | { type: "approve_ticket"; ticketId: string }
  | { type: "reject_ticket"; ticketId: string; reason?: string };

export type RunnerToServerEvent =
  | { type: "job_log"; ticketId: string; line: string; ts: string }
  | { type: "job_status"; ticketId: string; status: Ticket["status"] }
  | { type: "job_heartbeat"; ticketId: string; ts: string }
  | { type: "job_meta"; ticketId: string; worktreePath?: string; sessionId?: string }
  | { type: "manager_log"; requestId: string; line: string; ts: string }
  | { type: "manager_result"; requestId: string; resultText: string; success: boolean }
  | { type: "merge_result"; ticketId: string; success: boolean; message: string };

export type ServerToRunnerEvent =
  | { type: "job_assign"; ticket: Ticket }
  | { type: "job_cancel"; ticketId: string }
  | { type: "invoke_manager"; requestId: string; message: string }
  | { type: "merge_ticket"; ticketId: string; project: string; branch: string; worktreePath: string };
