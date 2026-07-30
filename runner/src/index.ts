import WebSocket from "ws";
import type { RunnerToServerEvent, ServerToRunnerEvent, Ticket } from "@ai-crew/shared";
import { runMock } from "./drivers/mock.js";

const SERVER_WS_URL = process.env.SERVER_WS_URL ?? "ws://localhost:8080/ws/runner";
const MAX_CONCURRENT = Number(process.env.RUNNER_MAX_CONCURRENT ?? 2);
const RECONNECT_DELAY_MS = 2000;

let ws: WebSocket;
let active = 0;
const queue: Ticket[] = [];

function send(event: RunnerToServerEvent) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }
}

function drain() {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    const ticket = queue.shift()!;
    active++;
    console.log(`[runner] starting ${ticket.id} (${ticket.project}) - active=${active}, queued=${queue.length}`);
    runMock(ticket, send)
      .catch((err) => console.error(`[runner] job ${ticket.id} failed`, err))
      .finally(() => {
        active--;
        console.log(`[runner] finished ${ticket.id} - active=${active}, queued=${queue.length}`);
        drain();
      });
  }
}

function connect() {
  ws = new WebSocket(SERVER_WS_URL);

  ws.on("open", () => {
    console.log(`[runner] connected to ${SERVER_WS_URL} (max concurrent = ${MAX_CONCURRENT})`);
  });

  ws.on("message", (raw) => {
    const event = JSON.parse(raw.toString()) as ServerToRunnerEvent;
    if (event.type === "job_assign") {
      queue.push(event.ticket);
      drain();
    }
  });

  ws.on("close", () => {
    console.log(`[runner] disconnected, retrying in ${RECONNECT_DELAY_MS}ms`);
    setTimeout(connect, RECONNECT_DELAY_MS);
  });

  ws.on("error", (err) => {
    console.error("[runner] ws error", err.message);
  });
}

connect();
