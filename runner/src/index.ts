import { execFile } from "node:child_process";
import { promisify } from "node:util";
import WebSocket from "ws";
import type { DriverStatus, RunnerToServerEvent, ServerToRunnerEvent, Ticket } from "@ai-crew/shared";
import { fetchEmployees } from "./employees/api.js";
import { runClaudeDriver } from "./drivers/claude.js";
import { runGeminiDriver } from "./drivers/gemini.js";
import { runCodexDriver } from "./drivers/codex.js";
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

function send(event: RunnerToServerEvent) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }
}

// 직원 명단은 파일이 아니라 서버(DB)에서 매번 새로 가져온다 - 웹에서 직원을 추가/삭제해도
// 러너 재시작이 필요 없다. ticket.role은 직원의 name과 같다.
async function runJob(ticket: Ticket): Promise<void> {
  const employees = await fetchEmployees();
  const employee = employees.find((e) => e.name === ticket.role);

  if (!employee) {
    console.log(`[runner] role "${ticket.role}"에 맞는 직원이 없어 mock으로 대체합니다`);
    return runMock(ticket, send);
  }

  switch (employee.driver) {
    case "claude":
      return runClaudeDriver(ticket, employee, send);
    case "gemini":
      return runGeminiDriver(ticket, employee, send);
    case "codex":
      return runCodexDriver(ticket, employee, send);
    default:
      console.log(`[runner] "${employee.driver}" 드라이버는 아직 없어 mock으로 대체합니다`);
      return runMock(ticket, send);
  }
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

const execFileAsync = promisify(execFile);
const DRIVER_BINARIES: Record<string, string> = { claude: "claude", gemini: "gemini", codex: "codex" };

// 웹 UI에서 직원을 추가할 때 "이 CLI가 이 맥에 설치돼 있나" 보여주기 위한 것. 설치 여부만
// 확인한다 - 로그인(OAuth) 여부는 브라우저에서 대신 눌러줄 수 있는 게 아니라서 실제로 티켓을
// 돌려봐야 알 수 있다 (인증 실패 시 job 로그에 에러가 그대로 보인다).
async function handleCheckDriverStatus(requestId: string) {
  const status: Record<string, DriverStatus> = {};
  for (const [driver, bin] of Object.entries(DRIVER_BINARIES)) {
    try {
      const { stdout } = await execFileAsync(bin, ["--version"]);
      status[driver] = { installed: true, versionOrError: stdout.trim() };
    } catch (err) {
      status[driver] = {
        installed: false,
        versionOrError: err instanceof Error ? err.message : String(err),
      };
    }
  }
  send({ type: "driver_status_result", requestId, status });
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
    } else if (event.type === "check_driver_status") {
      handleCheckDriverStatus(event.requestId);
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
