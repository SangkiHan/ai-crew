import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { DriverStatus, PlanningDoc, RunnerToServerEvent, ServerToRunnerEvent, Ticket } from "@ai-crew/shared";
import {
  ensureAssigned,
  findActiveTicketForProject,
  findNextQueuedForProject,
  findOrphaned,
  getTicket,
  isProjectBusyStatus,
  projectKey,
  recordHeartbeat,
  saveTicketMemory,
  ticketEvents,
  transitionTicket,
  updateMeta,
} from "../tickets/store.js";
import { findQaEmployee } from "../employees/store.js";
import { planningDocEvents, updatePlanningDocResult } from "../planning/store.js";
import { saveChatMessage } from "../chat/store.js";
import { broadcastToUi } from "./ui.js";

const runnerSockets = new Set<WebSocket>();
let subscribed = false;
// 프로젝트 폴더 하나당 배정 판단을 직렬화하는 락 (tickets/store.ts의 withTicketLock과 같은 패턴).
// 티켓 단위 락으로는 부족하다 - 막으려는 건 "서로 다른 두 티켓이 같은 폴더에 동시에 들어가는 것"이라
// 검사와 배정이 한 덩어리로 묶여야 한다.
const projectDispatchLocks = new Map<string, Promise<unknown>>();

function withProjectLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = projectDispatchLocks.get(key) ?? Promise.resolve();
  const run = prev.then(fn);
  projectDispatchLocks.set(
    key,
    run.then(
      () => undefined,
      () => undefined
    )
  );
  return run;
}

// 팀마다 팀장이 독립적으로 바쁠 수 있다 - teamId별로 추적한다.
const busyTeams = new Set<string>();
const pendingDriverStatusChecks = new Map<string, (status: Record<string, DriverStatus>) => void>();
const pendingCreateProjectRequests = new Map<
  string,
  (result: { success: boolean; path?: string; error?: string }) => void
>();
const pendingConsultRequests = new Map<
  string,
  (result: { success: boolean; answer?: string; error?: string }) => void
>();
const pendingEndSessionRequests = new Map<string, (result: { success: boolean; error?: string }) => void>();

export function registerRunnerWs(app: FastifyInstance) {
  app.get("/ws/runner", { websocket: true }, (socket: WebSocket) => {
    runnerSockets.add(socket);
    app.log.info("runner connected");

    // 러너가 (재)연결되면 큐에 남아있던 티켓과, 죽기 전 running/assigned 상태였던
    // 티켓을 다시 밀어준다 - 이게 "러너 강제종료 후 재시작 -> 복구" 경로다.
    recoverAndAssign(socket).catch((err) => app.log.error(err, "recoverAndAssign failed"));

    socket.on("message", async (raw: Buffer) => {
      try {
        const event = JSON.parse(raw.toString()) as RunnerToServerEvent;
        await handleRunnerEvent(event, app);
      } catch (err) {
        app.log.error(err, "failed to handle runner event");
      }
    });

    socket.on("close", () => {
      runnerSockets.delete(socket);
      app.log.info("runner disconnected");
    });
  });

  if (!subscribed) {
    subscribed = true;
    // 티켓이 어떻게 바뀌든(러너 이벤트든, REST 승인/거부든) UI에는 여기서 한 곳으로만 알린다.
    ticketEvents.on("changed", (ticket) => {
      broadcastToUi({ type: "ticket_updated", ticket });
      if (ticket.status === "queued") {
        pushToAnyRunner(ticket.id).catch((err) => app.log.error(err, "pushToAnyRunner failed"));
      } else if (!isProjectBusyStatus(ticket.status)) {
        // 이 티켓이 프로젝트 폴더를 놓았다 - 같은 폴더에서 기다리던 다음 티켓을 내보낸다.
        // (여기서 배정되는 티켓은 assigned = busy 상태가 되므로 이 분기가 다시 타지 않는다.)
        releaseNextQueuedForProject(ticket.project).catch((err) =>
          app.log.error(err, "releaseNextQueuedForProject failed")
        );
      }
    });

    // 기획서도 티켓과 같은 방식으로 상태가 바뀔 때마다 UI에 알린다. 이 구독이 없어서 지금까지
    // planningDocEvents는 emit만 되고 아무도 듣지 않았고(죽은 이벤트), 러너가 작성을 끝냈을 때만
    // 따로 broadcast가 있었다 - 그래서 "기획자에게 위임됨(drafting)"이 UI에 전혀 안 보이고
    // 조직도의 기획자 노드도 계속 대기 상태로 남았다.
    planningDocEvents.on("changed", (doc: PlanningDoc) => {
      broadcastToUi({ type: "planning_doc_updated", doc });
    });
  }
}

async function handleRunnerEvent(event: RunnerToServerEvent, app: FastifyInstance) {
  if (event.type === "job_status") {
    // 개발 완료(review로 가려는 순간) 그 팀에 QA 담당 직원이 있으면 사람 승인 전에
    // QA 검증 단계(qa_review)를 먼저 거치도록 가로챈다. 없으면 기존과 동일하게 바로 review.
    // (QA 검증 자체의 결과는 이 경로로 오지 않는다 - QA 직원은 report_qa_result MCP 툴로
    // POST /api/tickets/:id/qa-result를 직접 호출한다. report_blocked와 같은 패턴이다.)
    if (event.status === "review") {
      const ticket = await getTicket(event.ticketId);
      const qaEmployee = ticket ? await findQaEmployee(ticket.teamId) : null;
      if (ticket && qaEmployee && qaEmployee.name !== ticket.role) {
        const updated = await transitionTicket(event.ticketId, "qa_review");
        await pushToAnyRunner(updated.id);
      } else {
        // transitionTicket이 반환하는 티켓에는 resultText/diffSummary가 이미 반영돼 있다 -
        // 같은 티켓에 대한 락(withTicketLock)이 job_meta -> job_status 순서를 보장하므로,
        // 여기서 다시 조회할 필요 없이 이 반환값을 그대로 쓴다.
        //
        // 사용자 결정: 사람이 매번 UI에서 승인 버튼을 누를 필요가 없다 - 직원이 프로젝트 실제
        // 폴더의 현재 브랜치에 직접 커밋하므로, review는 "승인을 기다리는 관문"이 아니라
        // 이미 끝난 작업을 곧장 done으로 넘기는 경유지일 뿐이다. 그래서 팀장에게 보내는 알림도
        // done으로 넘긴 "뒤에" 과거형으로 보낸다 - "승인해달라"고 안내하면 실제 동작과
        // 안 맞아서 팀장이 스스로 그 모순을 알아채고 엉뚱한 데(자기 소스코드)를 뒤지게 된다.
        const reviewed = await transitionTicket(event.ticketId, "review");
        const done = await autoApproveTicket(reviewed);
        notifyManagerOfTicketResult(done, "done");
      }
    } else {
      const updated = await transitionTicket(event.ticketId, event.status);
      if (event.status === "failed") notifyManagerOfTicketResult(updated, "failed");
    }
  } else if (event.type === "planning_doc_log") {
    app.log.info({ planningDocId: event.planningDocId }, event.line);
  } else if (event.type === "planning_doc_result") {
    // UI 알림은 planningDocEvents 구독자 한 곳에서만 처리한다 (티켓과 같은 패턴) - 여기서
    // 또 broadcast하면 같은 갱신이 두 번 나간다.
    await updatePlanningDocResult(event.planningDocId, event.success, event.content, event.sessionId);
  } else if (event.type === "job_log") {
    broadcastToUi({ type: "log_line", ticketId: event.ticketId, line: event.line, ts: event.ts });
  } else if (event.type === "job_heartbeat") {
    await recordHeartbeat(event.ticketId);
  } else if (event.type === "job_meta") {
    await updateMeta(event.ticketId, {
      branch: event.branch,
      baseSha: event.baseSha,
      sessionId: event.sessionId,
      resultText: event.resultText,
      diffSummary: event.diffSummary,
    });
  } else if (event.type === "manager_log") {
    broadcastToUi({
      type: "manager_log",
      teamId: event.teamId,
      requestId: event.requestId,
      line: event.line,
      ts: event.ts,
    });
  } else if (event.type === "manager_result") {
    busyTeams.delete(event.teamId);
    if (event.resultText) {
      saveChatMessage(event.teamId, "manager", event.resultText).catch((err) =>
        app.log.error(err, "manager 응답 저장 실패")
      );
    }
    broadcastToUi({
      type: "manager_result",
      teamId: event.teamId,
      requestId: event.requestId,
      resultText: event.resultText,
      success: event.success,
    });
    broadcastToUi({ type: "manager_status", teamId: event.teamId, status: "idle" });
  } else if (event.type === "driver_status_result") {
    const resolve = pendingDriverStatusChecks.get(event.requestId);
    if (resolve) {
      resolve(event.status);
      pendingDriverStatusChecks.delete(event.requestId);
    }
  } else if (event.type === "create_project_result") {
    const resolve = pendingCreateProjectRequests.get(event.requestId);
    if (resolve) {
      resolve({ success: event.success, path: event.path, error: event.error });
      pendingCreateProjectRequests.delete(event.requestId);
    }
  } else if (event.type === "consult_employee_result") {
    const resolve = pendingConsultRequests.get(event.requestId);
    if (resolve) {
      resolve({ success: event.success, answer: event.answer, error: event.error });
      pendingConsultRequests.delete(event.requestId);
    }
  } else if (event.type === "end_session_result") {
    const resolve = pendingEndSessionRequests.get(event.requestId);
    if (resolve) {
      resolve({ success: event.success, error: event.error });
      pendingEndSessionRequests.delete(event.requestId);
    }
  }
}

// 직원이 작업을 끝냈는데도(성공/실패 모두) 팀장한테 아무 보고가 안 가서 사용자가 채팅에서
// 아무 결과도 못 보는 문제가 있었다 - 티켓 상세 화면을 직접 열어봐야만 알 수 있었다. done으로
// 넘어가거나 최종 실패했을 때 팀장을 깨워 직원의 최종 보고(resultText)와 변경사항 요약
// (diffSummary)을 전달하고, 사용자에게 요약해서 알리도록 한다. 팀장이 이미 바쁘면(busyTeams)
// requestManagerInvocation이 조용히 스킵한다 - blocked 알림(REST /block 경로)과 같은 한계다.
//
// "done" 케이스는 반드시 autoApproveTicket이 끝난 뒤(과거형으로) 호출해야 한다 - 아직
// 진행 중인 것처럼("검수를 요청했습니다") 안내하면서 정작 승인 버튼은 없고 이미 자동으로
// 처리되는 모순이 생겨서, 팀장이 그 모순을 스스로 알아채고 자기 소스코드를 뒤지는
// 엉뚱한 행동을 한 적이 있다 - 알림 문구는 항상 "이미 어떻게 됐다"만 말해야 한다.
export function notifyManagerOfTicketResult(
  ticket: Ticket,
  outcome: "done" | "failed" | "needs_approval"
): void {
  const message =
    outcome === "done"
      ? `직원 "${ticket.role}"이 티켓 작업을 완료했습니다. 사람 승인 절차 없이 자동으로 ` +
        `프로젝트의 현재 브랜치에 이미 커밋되어 있습니다 (별도로 승인/거부/머지할 것이 없습니다).\n\n` +
        `- 티켓: ${ticket.title}\n- 프로젝트: ${ticket.project}\n- 브랜치: ${ticket.branch ?? "(확인 안 됨)"}\n` +
        `- 변경사항: ${ticket.diffSummary ?? "(확인 중)"}\n\n` +
        `## 직원의 최종 보고\n${ticket.resultText ?? "(보고 없음)"}\n\n` +
        `위 내용을 사용자에게 요약해서 전달하세요. 이미 끝난 일이니 당신이 추가로 할 조치는 없습니다.`
      : outcome === "needs_approval"
        ? `직원 "${ticket.role}"의 티켓이 QA 검증에서 ${ticket.qaCycles}회 연속 반려되어 ` +
          `사람 확인이 필요한 상태(needs_approval)가 됐습니다.\n\n` +
          `- 티켓: ${ticket.title}\n- 프로젝트: ${ticket.project}\n` +
          `- QA의 마지막 반려 사유: ${ticket.qaNote ?? "(없음)"}\n\n` +
          `사용자에게 이 상황을 전달하세요. 계속 재시도할지, 포기할지는 사용자가 UI에서 승인/거부로 ` +
          `직접 결정합니다 - 당신이 대신 결정할 수는 없습니다.`
        : `직원 "${ticket.role}"의 티켓 작업이 실패로 종료됐습니다.\n\n` +
          // ticketId를 명시해야 팀장이 list_tickets로 되찾는 단계 없이 바로 schedule_ticket_retry를
          // 부를 수 있다 (같은 제목의 실패 티켓이 여러 개면 제목만으로는 특정이 안 된다).
          `- 티켓 id: ${ticket.id}\n- 티켓: ${ticket.title}\n- 프로젝트: ${ticket.project}\n\n` +
          `## 직원의 마지막 보고\n${ticket.resultText ?? "(보고 없음)"}\n\n` +
          `사용량/session 제한으로 보이는 원문 오류라면 schedule_ticket_retry(위 티켓 id 사용)로 ` +
          `제한 해제 후 자동 재실행을 예약하세요 - 오류 문구에 리셋 시각이 있으면 그 시각 조금 뒤로, ` +
          `없으면 60분 뒤로 delayMinutes를 잡고, 예약했다는 사실과 예약 시각을 사용자에게 알리세요. ` +
          `컨텍스트 초과·코드 오류·권한 오류라면 예약하지 말고 사용자에게 실패 사실과 사유를 전달하세요.`;
  requestManagerInvocation(ticket.teamId, message);
}

// review에 도달한 티켓을 사람 승인 없이 바로 done으로 넘긴다 - QA 통과 티켓이 이미 이렇게
// 동작하는 것과 같은 정책이다(applyQaVerdict). 직원은 프로젝트 실제 폴더의 현재 브랜치에
// 이미 직접 커밋했으므로(격리된 워크트리/새 브랜치가 없다) 여기서 별도로 병합할 것도 없다.
async function autoApproveTicket(ticket: Ticket): Promise<Ticket> {
  const done = await transitionTicket(ticket.id, "done");
  saveTicketMemory(done);
  return done;
}

export interface ManagerInvocationRequest {
  ok: true;
  requestId: string;
}
export interface ManagerInvocationRejected {
  ok: false;
  reason: "busy" | "no_runner";
}

// 브라우저 채팅바 -> 팀장. 같은 팀 안에서는 한 번에 하나의 팀장 호출만 진행한다
// (세션/워크트리 충돌 방지) - 다른 팀의 팀장은 독립적으로 동시에 호출될 수 있다.
export function requestManagerInvocation(
  teamId: string,
  message: string
): ManagerInvocationRequest | ManagerInvocationRejected {
  if (busyTeams.has(teamId)) return { ok: false, reason: "busy" };
  const socket = [...runnerSockets][0];
  if (!socket) return { ok: false, reason: "no_runner" };

  const requestId = crypto.randomUUID();
  busyTeams.add(teamId);
  broadcastToUi({ type: "manager_status", teamId, status: "busy" });
  const event: ServerToRunnerEvent = { type: "invoke_manager", requestId, teamId, message };
  socket.send(JSON.stringify(event));
  return { ok: true, requestId };
}

// 팀장이 create_planning_doc으로 위임하거나(최초), 사람이 수정 요청을 남기면(티키타카) 호출된다.
// 실제 기획서 작성은 호스트(러너)에서 그 직원의 CLI 세션으로 진행된다(worktree/git 없이 텍스트만
// 생성). resumeSessionId가 있으면 이전 초안과 같은 대화를 이어서 다듬는다.
export function requestPlanningDocJob(doc: PlanningDoc, message: string, resumeSessionId?: string): void {
  const socket = [...runnerSockets][0];
  if (!socket) return; // 러너가 없으면 조용히 스킵 - drafting 상태로 남는다 (사람이 나중에 재시도 필요)
  const event: ServerToRunnerEvent = {
    type: "planning_doc_assign",
    planningDocId: doc.id,
    teamId: doc.teamId,
    employeeName: doc.employeeName,
    message,
    resumeSessionId,
  };
  socket.send(JSON.stringify(event));
}

// 사람이 review 티켓에 수정 요청을 남기면 호출된다. 새 티켓이 아니라 프로젝트 실제 폴더에서
// 그 티켓을 작업했던 담당 직원의 Claude Code 세션(sessionId)을 그대로 이어서(--resume)
// 수정사항을 반영한다 - 기획서 티키타카 수정 요청과 같은 패턴이다.
export function requestTicketRevise(ticket: Ticket, message: string): void {
  const socket = [...runnerSockets][0];
  if (!socket) return; // 러너가 없으면 조용히 스킵 - 티켓은 running으로 남고 사람이 나중에 재시도해야 함
  const event: ServerToRunnerEvent = { type: "ticket_revise", ticket, message };
  socket.send(JSON.stringify(event));
}

// 웹 UI의 직원 추가 폼에서 "이 CLI 설치돼 있나요?" 확인할 때 쓴다. 러너가 없거나 5초 안에
// 응답이 없으면 빈 상태로 반환한다 (UI는 "확인 불가"로 표시하면 된다).
export async function requestDriverStatus(): Promise<Record<string, DriverStatus>> {
  const socket = [...runnerSockets][0];
  if (!socket) return {};

  const requestId = crypto.randomUUID();
  const event: ServerToRunnerEvent = { type: "check_driver_status", requestId };

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingDriverStatusChecks.delete(requestId);
      resolve({});
    }, 5000);
    pendingDriverStatusChecks.set(requestId, (status) => {
      clearTimeout(timeout);
      resolve(status);
    });
    socket.send(JSON.stringify(event));
  });
}

// 팀장의 create_project MCP 툴이 호출한다. 실제 git clone/init/템플릿 복사는 호스트(러너)에서만
// 가능하다 (서버는 컨테이너 안이라 WORKSPACE_ROOT 실물 경로에 접근 못 함). git clone은 시간이
// 걸릴 수 있어 타임아웃을 넉넉히 둔다.
export async function requestCreateProject(
  name: string,
  gitUrl?: string,
  stack?: string
): Promise<{ success: boolean; path?: string; error?: string }> {
  const socket = [...runnerSockets][0];
  if (!socket) return { success: false, error: "러너가 연결되어 있지 않습니다." };

  const requestId = crypto.randomUUID();
  const event: ServerToRunnerEvent = { type: "create_project_request", requestId, name, gitUrl, stack };

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingCreateProjectRequests.delete(requestId);
      resolve({ success: false, error: "120초 안에 응답이 없습니다 (git clone이 오래 걸릴 수 있음)." });
    }, 120000);
    pendingCreateProjectRequests.set(requestId, (result) => {
      clearTimeout(timeout);
      resolve(result);
    });
    socket.send(JSON.stringify(event));
  });
}

// 기획자/직원의 ask_employee MCP 툴 전용. 실제 조사는 호스트(러너)에서 그 프로젝트 폴더를 읽기
// 전용으로 여는 임시 세션으로 진행되므로, 실제 코드를 읽는 시간을 감안해 넉넉히 대기한다.
// fromEmployeeName이 있으면(직원이 다른 직원에게 물어본 경우) 질문자/답변자 둘 다 org chart에
// "상담 중"으로 표시되도록 시작/종료 시점에 브로드캐스트한다 - 없으면(기획 세션이 물어본 경우)
// 답변자만 표시한다.
export async function requestConsultEmployee(
  teamId: string,
  employeeName: string,
  project: string,
  question: string,
  fromEmployeeName?: string
): Promise<{ success: boolean; answer?: string; error?: string }> {
  const socket = [...runnerSockets][0];
  if (!socket) return { success: false, error: "러너가 연결되어 있지 않습니다." };

  const requestId = crypto.randomUUID();
  const event: ServerToRunnerEvent = {
    type: "consult_employee_request",
    requestId,
    teamId,
    employeeName,
    project,
    question,
    fromEmployeeName,
  };
  const participants = fromEmployeeName ? [fromEmployeeName, employeeName] : [employeeName];

  broadcastToUi({ type: "employee_consult_status", teamId, employeeNames: participants, status: "consulting" });

  return new Promise((resolve) => {
    const finish = (result: { success: boolean; answer?: string; error?: string }) => {
      broadcastToUi({ type: "employee_consult_status", teamId, employeeNames: participants, status: "idle" });
      resolve(result);
    };
    const timeout = setTimeout(() => {
      pendingConsultRequests.delete(requestId);
      finish({ success: false, error: "90초 안에 응답이 없습니다." });
    }, 90000);
    pendingConsultRequests.set(requestId, (result) => {
      clearTimeout(timeout);
      finish(result);
    });
    socket.send(JSON.stringify(event));
  });
}

// 웹 UI의 "세션 종료" 버튼 전용. 러너(호스트)에 저장된 이 팀의 --resume 대상 세션 id를
// 지워서, 다음 팀장 호출부터 완전히 새 세션으로 시작하게 한다.
export async function requestEndSession(teamId: string): Promise<{ success: boolean; error?: string }> {
  const socket = [...runnerSockets][0];
  if (!socket) return { success: false, error: "러너가 연결되어 있지 않습니다." };

  const requestId = crypto.randomUUID();
  const event: ServerToRunnerEvent = { type: "end_session_request", requestId, teamId };

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingEndSessionRequests.delete(requestId);
      resolve({ success: false, error: "10초 안에 응답이 없습니다." });
    }, 10000);
    pendingEndSessionRequests.set(requestId, (result) => {
      clearTimeout(timeout);
      resolve(result);
    });
    socket.send(JSON.stringify(event));
  });
}

async function recoverAndAssign(socket: WebSocket) {
  const orphaned = await findOrphaned();
  // 러너가 죽었다 돌아온 직후에는 running 티켓의 하트비트가 오래돼 stale(점유 해제)로 보이는데,
  // 바로 이 루프에서 그 티켓 자체를 되살린다 - stale 판정 때문에 같은 프로젝트의 queued까지
  // 함께 내보내면 한 폴더에 두 세션이 동시에 도는 사고가 난다(실제 발생). 복구 대상
  // (assigned/running)이 있는 프로젝트의 queued는 이번 라운드에서 건너뛴다 - 복구된 티켓이
  // 끝나면 changed 이벤트가 releaseNextQueuedForProject로 알아서 다음 것을 내보낸다.
  const busyProjects = new Set(
    orphaned.filter((t) => t.status !== "queued").map((t) => projectKey(t.project))
  );
  for (const ticket of orphaned) {
    if (ticket.status === "queued" && busyProjects.has(projectKey(ticket.project))) continue;
    await pushJob(socket, ticket.id);
  }
}

export async function pushToAnyRunner(ticketId: string) {
  const socket = [...runnerSockets][0];
  if (!socket) return; // 붙어있는 러너가 없으면, 다음 러너 연결 시 recoverAndAssign이 집어간다
  await pushJob(socket, ticketId);
}

async function pushJob(socket: WebSocket, ticketId: string) {
  const ticket = await getTicket(ticketId);
  if (!ticket) return;

  // 아직 큐에 있는 티켓만 프로젝트 점유 검사를 한다. 이미 assigned/running인 티켓을 다시
  // 미는 건 러너 재연결 복구 경로(recoverAndAssign)라, 여기서 막으면 되살아나지 못하고 영영
  // 멈춘다 - 그건 이 검사가 막으려는 상황(새 티켓을 남의 작업 위에 얹는 것)이 아니다.
  if (ticket.status === "queued") {
    // 같은 폴더에 대한 배정 판단을 직렬화한다. 이게 없으면 티켓 두 개가 거의 동시에 큐에
    // 들어왔을 때 양쪽 다 "지금 비어있다"를 보고 둘 다 나가버린다.
    await withProjectLock(projectKey(ticket.project), async () => {
      const active = await findActiveTicketForProject(ticket.project, ticket.id);
      if (active) {
        broadcastToUi({
          type: "log_line",
          ticketId: ticket.id,
          line:
            `[대기] 같은 프로젝트에서 "${active.title}"(${active.role})가 아직 작업 중이라 ` +
            `이 티켓은 큐에서 기다립니다. 앞 티켓이 끝나면 자동으로 시작됩니다.`,
          ts: new Date().toISOString(),
        });
        return;
      }
      // ensureAssigned는 락으로 직렬화되고, 이미 assigned/running이면 그대로 반환한다 -
      // recoverAndAssign과 신규 티켓 이벤트가 동시에 같은 티켓을 밀어도 안전하다. 상태가 실제로
      // 바뀌면 ensureAssigned 내부에서 ticketEvents("changed")가 UI 브로드캐스트까지 처리한다.
      const assigned = await ensureAssigned(ticketId);
      const event: ServerToRunnerEvent = { type: "job_assign", ticket: assigned };
      socket.send(JSON.stringify(event));
    });
    return;
  }

  const event: ServerToRunnerEvent = { type: "job_assign", ticket };
  socket.send(JSON.stringify(event));
}

// 앞 티켓이 그 폴더를 놓았을 때(review/done/failed/blocked 등으로 빠졌을 때) 같은 프로젝트에서
// 기다리던 다음 티켓을 하나만 내보낸다. 여러 번 불려도 안전하다 - 매번 점유 여부를 다시 확인하고,
// 큐에서 가장 오래된 것 하나만 집는다.
async function releaseNextQueuedForProject(project: string): Promise<void> {
  await withProjectLock(projectKey(project), async () => {
    const active = await findActiveTicketForProject(project);
    if (active) return;
    const next = await findNextQueuedForProject(project);
    if (!next) return;
    const socket = [...runnerSockets][0];
    if (!socket) return; // 러너가 없으면 다음 연결 때 recoverAndAssign이 집어간다
    const assigned = await ensureAssigned(next.id);
    const event: ServerToRunnerEvent = { type: "job_assign", ticket: assigned };
    socket.send(JSON.stringify(event));
  });
}
