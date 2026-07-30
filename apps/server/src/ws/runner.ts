import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { DriverStatus, RunnerToServerEvent, ServerToRunnerEvent } from "@ai-crew/shared";
import {
  ensureAssigned,
  findOrphaned,
  getTicket,
  recordHeartbeat,
  ticketEvents,
  transitionTicket,
  updateMeta,
} from "../tickets/store.js";
import { broadcastToUi } from "./ui.js";

const runnerSockets = new Set<WebSocket>();
let subscribed = false;
let managerBusy = false;
const pendingDriverStatusChecks = new Map<string, (status: Record<string, DriverStatus>) => void>();

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
      }
    });
  }
}

async function handleRunnerEvent(event: RunnerToServerEvent, app: FastifyInstance) {
  if (event.type === "job_status") {
    await transitionTicket(event.ticketId, event.status);
  } else if (event.type === "job_log") {
    broadcastToUi({ type: "log_line", ticketId: event.ticketId, line: event.line, ts: event.ts });
  } else if (event.type === "job_heartbeat") {
    await recordHeartbeat(event.ticketId);
  } else if (event.type === "job_meta") {
    await updateMeta(event.ticketId, {
      worktreePath: event.worktreePath,
      sessionId: event.sessionId,
    });
  } else if (event.type === "manager_log") {
    broadcastToUi({ type: "manager_log", requestId: event.requestId, line: event.line, ts: event.ts });
  } else if (event.type === "manager_result") {
    managerBusy = false;
    broadcastToUi({
      type: "manager_result",
      requestId: event.requestId,
      resultText: event.resultText,
      success: event.success,
    });
    broadcastToUi({ type: "manager_status", status: "idle" });
  } else if (event.type === "merge_result") {
    broadcastToUi({
      type: "log_line",
      ticketId: event.ticketId,
      line: `[merge] ${event.success ? "성공" : "실패"}: ${event.message}`,
      ts: new Date().toISOString(),
    });
  } else if (event.type === "driver_status_result") {
    const resolve = pendingDriverStatusChecks.get(event.requestId);
    if (resolve) {
      resolve(event.status);
      pendingDriverStatusChecks.delete(event.requestId);
    }
  }
}

export interface ManagerInvocationRequest {
  ok: true;
  requestId: string;
}
export interface ManagerInvocationRejected {
  ok: false;
  reason: "busy" | "no_runner";
}

// 브라우저 채팅바 -> 팀장. 한 번에 하나의 팀장 호출만 진행한다 (세션/워크트리 충돌 방지).
export function requestManagerInvocation(
  message: string
): ManagerInvocationRequest | ManagerInvocationRejected {
  if (managerBusy) return { ok: false, reason: "busy" };
  const socket = [...runnerSockets][0];
  if (!socket) return { ok: false, reason: "no_runner" };

  const requestId = crypto.randomUUID();
  managerBusy = true;
  broadcastToUi({ type: "manager_status", status: "busy" });
  const event: ServerToRunnerEvent = { type: "invoke_manager", requestId, message };
  socket.send(JSON.stringify(event));
  return { ok: true, requestId };
}

// review 티켓이 done으로 승인되면 호출된다. 실제 git merge는 호스트(러너)에서만 가능하다.
export function requestMerge(ticketId: string, project: string, branch: string, worktreePath: string): void {
  const socket = [...runnerSockets][0];
  if (!socket) return; // 러너가 없으면 조용히 스킵 - 사람이 나중에 수동으로 머지해야 함
  const event: ServerToRunnerEvent = { type: "merge_ticket", ticketId, project, branch, worktreePath };
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

async function recoverAndAssign(socket: WebSocket) {
  const orphaned = await findOrphaned();
  for (const ticket of orphaned) {
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
  // ensureAssigned는 락으로 직렬화되고, 이미 assigned/running이면 그대로 반환한다 -
  // recoverAndAssign과 신규 티켓 이벤트가 동시에 같은 티켓을 밀어도 안전하다.
  // 상태가 실제로 바뀌면 ensureAssigned 내부에서 ticketEvents("changed")가 UI 브로드캐스트까지 처리한다.
  const assigned = ticket.status === "queued" ? await ensureAssigned(ticketId) : ticket;
  const event: ServerToRunnerEvent = { type: "job_assign", ticket: assigned };
  socket.send(JSON.stringify(event));
}
