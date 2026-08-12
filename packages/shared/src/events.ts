import type { PlanningDoc } from "./planning-doc.js";
import type { Ticket } from "./ticket.js";

export type ServerToUiEvent =
  | { type: "ticket_updated"; ticket: Ticket }
  | { type: "log_line"; ticketId: string; line: string; ts: string }
  | { type: "agent_status"; agentId: string; status: "idle" | "busy" }
  | { type: "manager_log"; teamId: string; requestId: string; line: string; ts: string }
  | { type: "manager_result"; teamId: string; requestId: string; resultText: string; success: boolean }
  | { type: "manager_status"; teamId: string; status: "idle" | "busy" }
  | { type: "planning_doc_updated"; doc: PlanningDoc }
  // ask_employee(consult)로 직원 간 실시간 소통이 시작/종료될 때 - 두 직원(질문자/답변자)
  // 이름을 같이 보내 org chart에서 둘 다 "상담 중"으로 표시할 수 있게 한다.
  // 직원 이름은 팀 안에서만 유일하므로 어느 팀의 상담인지 함께 보낸다 - 없으면 다른 팀의
  // 동명이인 노드까지 같이 "상담 중"으로 켜진다. 상담은 항상 같은 팀 안에서만 일어난다.
  | { type: "employee_consult_status"; teamId: string; employeeNames: string[]; status: "consulting" | "idle" };

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
  | {
      type: "job_meta";
      ticketId: string;
      branch?: string;
      baseSha?: string;
      sessionId?: string;
      resultText?: string;
      diffSummary?: string;
    }
  | { type: "manager_log"; teamId: string; requestId: string; line: string; ts: string }
  | { type: "manager_result"; teamId: string; requestId: string; resultText: string; success: boolean }
  | { type: "driver_status_result"; requestId: string; status: Record<string, DriverStatus> }
  | { type: "planning_doc_log"; planningDocId: string; line: string; ts: string }
  | {
      type: "planning_doc_result";
      planningDocId: string;
      success: boolean;
      content: string;
      sessionId?: string;
    }
  | { type: "create_project_result"; requestId: string; success: boolean; path?: string; error?: string }
  | { type: "consult_employee_result"; requestId: string; success: boolean; answer?: string; error?: string }
  | { type: "end_session_result"; requestId: string; success: boolean; error?: string }
  | { type: "launch_infra_browser_result"; requestId: string; success: boolean; error?: string };

export type ServerToRunnerEvent =
  | { type: "job_assign"; ticket: Ticket }
  | { type: "job_cancel"; ticketId: string }
  | { type: "invoke_manager"; requestId: string; teamId: string; message: string }
  | { type: "check_driver_status"; requestId: string }
  | {
      type: "planning_doc_assign";
      planningDocId: string;
      teamId: string;
      employeeName: string;
      // 최초 요청이면 사용자의 원래 기획 요청, 수정 요청(티키타카)이면 그 후속 메시지.
      message: string;
      // 이어서 쓰는 수정 요청이면 이전 초안의 세션 id (없으면 새 세션으로 시작). claude만
      // 의미가 있다 - 다른 드라이버는 세션 이어가기 자체를 지원하지 않아 항상 무시된다.
      resumeSessionId?: string;
      // message와 별개로 항상 원래 요청 원문을 함께 보낸다. resumeSessionId로 이어갈 수
      // 없는 경로(claude 세션 유실, 또는 애초에 이어가기를 지원하지 않는 드라이버)에서
      // "무엇에 대한 기획서인지"를 처음부터 다시 알려줘야 하기 때문이다.
      originalRequest: string;
      // 이번 실행 시작 시점의 기존 기획서 내용. 최초 요청이면 null, 수정 요청이면 직전 초안 -
      // 세션을 이어갈 수 없는 경로에서 이 내용을 다시 프롬프트에 실어 보내야 "수정"이 아니라
      // "완전히 새 기획서"가 나오는 걸 막을 수 있다.
      previousContent: string | null;
    }
  | {
      // review 상태 티켓에 사람이 수정 요청을 남기면 서버가 보낸다. 프로젝트 실제 폴더에서
      // 그대로 이어서 작업하며, ticket.sessionId로 같은 담당 직원의 Claude Code 세션을
      // --resume해서 이어간다 (기획서 티키타카와 같은 패턴).
      type: "ticket_revise";
      ticket: Ticket;
      message: string;
    }
  | {
      type: "create_project_request";
      requestId: string;
      name: string;
      gitUrl?: string;
      stack?: string;
    }
  | {
      type: "consult_employee_request";
      requestId: string;
      // 직원 이름은 팀 안에서만 유일하므로 어느 팀의 직원인지 함께 보낸다.
      teamId: string;
      employeeName: string;
      project: string;
      question: string;
      // 물어본 쪽이 동료 직원이면 그 이름, 기획자면 생략. 답하는 직원의 프롬프트를 "기획 질문"과
      // "동료의 개발 질문" 중 어느 쪽으로 세울지가 달라진다 - 후자는 화면/API 특정처럼 지금
      // 진행 중인 작업을 위한 질문이라 답의 성격이 다르다.
      fromEmployeeName?: string;
    }
  | { type: "end_session_request"; requestId: string; teamId: string }
  // 웹 UI의 "인프라 크롬" 버튼이 보낸다. 러너가 호스트에서 --remote-debugging-port를 연 크롬을
  // 직접 띄운다 - 팀장은 이 크롬에 나중에 CDP로 붙어서 이어서 조작한다(docs/INFRA_MANAGER_PLAN.md).
  | { type: "launch_infra_browser_request"; requestId: string }
  // 웹 UI의 "팀장 강제 종료" 버튼이 보낸다. job_cancel과 같은 fire-and-forget 패턴 - 서버가 이미
  // busyTeams/채팅에 취소 사실을 반영해뒀으니, 러너는 실제 프로세스만 정리하면 된다.
  | { type: "cancel_manager_request"; teamId: string };
