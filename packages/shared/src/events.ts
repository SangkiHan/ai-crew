import type { PlanningDoc } from "./planning-doc.js";
import type { Ticket } from "./ticket.js";

export type ServerToUiEvent =
  | { type: "ticket_updated"; ticket: Ticket }
  | { type: "log_line"; ticketId: string; line: string; ts: string }
  | { type: "agent_status"; agentId: string; status: "idle" | "busy" }
  | { type: "manager_log"; teamId: string; requestId: string; line: string; ts: string }
  | { type: "manager_result"; teamId: string; requestId: string; resultText: string; success: boolean }
  | { type: "manager_status"; teamId: string; status: "idle" | "busy" }
  | { type: "planning_doc_updated"; doc: PlanningDoc };

export type UiToServerEvent =
  | { type: "chat_message"; text: string }
  | { type: "approve_ticket"; ticketId: string }
  | { type: "reject_ticket"; ticketId: string; reason?: string };

export interface DriverStatus {
  installed: boolean;
  versionOrError: string;
}

export type RunnerToServerEvent =
  | { type: "job_log"; ticketId: string; line: string; ts: string }
  | { type: "job_status"; ticketId: string; status: Ticket["status"] }
  | { type: "job_heartbeat"; ticketId: string; ts: string }
  | { type: "job_meta"; ticketId: string; worktreePath?: string; sessionId?: string }
  | { type: "manager_log"; teamId: string; requestId: string; line: string; ts: string }
  | { type: "manager_result"; teamId: string; requestId: string; resultText: string; success: boolean }
  | { type: "merge_result"; ticketId: string; success: boolean; message: string }
  | { type: "driver_status_result"; requestId: string; status: Record<string, DriverStatus> }
  | { type: "planning_doc_log"; planningDocId: string; line: string; ts: string }
  | {
      type: "planning_doc_result";
      planningDocId: string;
      success: boolean;
      content: string;
      sessionId?: string;
    };

export type ServerToRunnerEvent =
  | { type: "job_assign"; ticket: Ticket }
  | { type: "job_cancel"; ticketId: string }
  | { type: "invoke_manager"; requestId: string; teamId: string; message: string }
  | { type: "merge_ticket"; ticketId: string; project: string; branch: string; worktreePath: string }
  | { type: "check_driver_status"; requestId: string }
  | {
      type: "planning_doc_assign";
      planningDocId: string;
      teamId: string;
      employeeName: string;
      // 최초 요청이면 사용자의 원래 기획 요청, 수정 요청(티키타카)이면 그 후속 메시지.
      message: string;
      // 이어서 쓰는 수정 요청이면 이전 초안의 세션 id (없으면 새 세션으로 시작).
      resumeSessionId?: string;
    };
