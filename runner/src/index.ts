import WebSocket from "ws";
import type { RunnerToServerEvent, ServerToRunnerEvent, Ticket } from "@ai-crew/shared";
import { loadEmployeeAgents } from "./agents/registry.js";
import { runClaudeDriver } from "./drivers/claude.js";
import { runMock } from "./drivers/mock.js";
import { invokeManager } from "./manager/invoke.js";
import { deleteBranch, mergeBranch, removeWorktree } from "./worktree.js";
import { projectPath } from "./workspace.js";

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

// 브라우저 채팅바 -> 서버 -> 여기로 온다. 티켓 큐와는 별개 경로 (동시 실행 수 제한에 안 걸림).
async function handleInvokeManager(requestId: string, message: string) {
  try {
    const result = await invokeManager(message, (line) =>
      send({ type: "manager_log", requestId, line, ts: new Date().toISOString() })
    );
    send({ type: "manager_result", requestId, resultText: result.resultText, success: result.success });
  } catch (err) {
    send({
      type: "manager_result",
      requestId,
      resultText: err instanceof Error ? err.message : String(err),
      success: false,
    });
  }
}

// 사람이 review 티켓을 승인(done)하면 서버가 이걸 보낸다. 실제로 메인 브랜치에 머지하는 건
// 호스트에서 git을 쓸 수 있는 여기(러너)뿐이다 - 서버는 컨테이너 안이라 프로젝트 폴더가 없다.
async function handleMergeTicket(event: { ticketId: string; project: string; branch: string; worktreePath: string }) {
  const repoPath = projectPath(event.project);
  try {
    await mergeBranch(repoPath, event.branch, `merge: ${event.branch} (ticket ${event.ticketId})`);
    await removeWorktree(repoPath, event.worktreePath);
    await deleteBranch(repoPath, event.branch);
    send({
      type: "merge_result",
      ticketId: event.ticketId,
      success: true,
      message: `${event.branch}를 메인 브랜치에 머지하고 워크트리를 정리했습니다.`,
    });
  } catch (err) {
    send({
      type: "merge_result",
      ticketId: event.ticketId,
      success: false,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

function drain() {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    const ticket = queue.shift()!;
    active++;
    console.log(`[runner] starting ${ticket.id} (${ticket.project}) - active=${active}, queued=${queue.length}`);
    runJob(ticket)
      .catch((err) => {
        console.error(`[runner] job ${ticket.id} failed`, err);
        // 드라이버가 예외로 죽으면(예: worktree 생성 실패) 티켓 상태를 아무도 안 바꿔서
        // running에 영원히 멈춘다. failed로 보내 사람이 보게 한다 - 이미 다른 종료 상태로
        // 전이된 경우(예: report_blocked 호출 후 죽음)엔 서버가 유효하지 않은 전이로 조용히 거부한다.
        send({
          type: "job_status",
          ticketId: ticket.id,
          status: "failed",
        });
        send({
          type: "job_log",
          ticketId: ticket.id,
          line: `[runner] 예외로 중단됨: ${err instanceof Error ? err.message : String(err)}`,
          ts: new Date().toISOString(),
        });
      })
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
    } else if (event.type === "invoke_manager") {
      handleInvokeManager(event.requestId, event.message);
    } else if (event.type === "merge_ticket") {
      handleMergeTicket(event);
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
