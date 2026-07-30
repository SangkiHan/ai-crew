import WebSocket from "ws";
import type { RunnerToServerEvent, ServerToRunnerEvent, Ticket } from "@ai-crew/shared";
import { loadEmployeeAgents } from "./agents/registry.js";
import { runClaudeDriver } from "./drivers/claude.js";
import { runMock } from "./drivers/mock.js";

const SERVER_WS_URL = process.env.SERVER_WS_URL ?? "ws://localhost:8080/ws/runner";
const MAX_CONCURRENT = Number(process.env.RUNNER_MAX_CONCURRENT ?? 2);
const RECONNECT_DELAY_MS = 2000;

let ws: WebSocket;
let active = 0;
const queue: Ticket[] = [];
const agents = await loadEmployeeAgents();
console.log(`[runner] loaded agents: ${[...agents.keys()].join(", ") || "(none)"}`);

function send(event: RunnerToServerEvent) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }
}

// role(=agents/*.md의 id)에 맞는 드라이버로 위임한다. driver가 아직 없는 역할(gemini/codex, 6단계)은
// mock으로 대체해 파이프라인 검증은 계속 가능하게 한다.
function runJob(ticket: Ticket): Promise<void> {
  const agent = agents.get(ticket.role);
  if (agent?.driver === "claude") {
    return runClaudeDriver(ticket, agent, send);
  }
  if (agent) {
    console.log(`[runner] "${agent.driver}" 드라이버는 아직 없어 mock으로 대체합니다 (role=${ticket.role})`);
  } else {
    console.log(`[runner] role "${ticket.role}"에 맞는 agents/*.md가 없어 mock으로 대체합니다`);
  }
  return runMock(ticket, send);
}

function drain() {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    const ticket = queue.shift()!;
    active++;
    console.log(`[runner] starting ${ticket.id} (${ticket.project}) - active=${active}, queued=${queue.length}`);
    runJob(ticket)
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
