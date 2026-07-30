import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { RunnerToServerEvent, ServerToRunnerEvent } from "@ai-crew/shared";
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
    ticketEvents.on("changed", (ticket) => {
      if (ticket.status === "queued") {
        pushToAnyRunner(ticket.id).catch((err) => app.log.error(err, "pushToAnyRunner failed"));
      }
    });
  }
}

async function handleRunnerEvent(event: RunnerToServerEvent, app: FastifyInstance) {
  if (event.type === "job_status") {
    const updated = await transitionTicket(event.ticketId, event.status);
    broadcastToUi({ type: "ticket_updated", ticket: updated });
  } else if (event.type === "job_log") {
    broadcastToUi({ type: "log_line", ticketId: event.ticketId, line: event.line, ts: event.ts });
  } else if (event.type === "job_heartbeat") {
    await recordHeartbeat(event.ticketId);
  } else if (event.type === "job_meta") {
    const updated = await updateMeta(event.ticketId, {
      worktreePath: event.worktreePath,
      sessionId: event.sessionId,
    });
    broadcastToUi({ type: "ticket_updated", ticket: updated });
  }
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
  const assigned = ticket.status === "queued" ? await ensureAssigned(ticketId) : ticket;
  if (assigned.status !== ticket.status) {
    broadcastToUi({ type: "ticket_updated", ticket: assigned });
  }
  const event: ServerToRunnerEvent = { type: "job_assign", ticket: assigned };
  socket.send(JSON.stringify(event));
}
