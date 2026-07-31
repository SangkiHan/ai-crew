import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import spawn from "cross-spawn";
import WebSocket from "ws";
import { isQaEmployee, type DriverStatus, type RunnerToServerEvent, type ServerToRunnerEvent, type Ticket } from "@ai-crew/shared";
import { fetchEmployees } from "./employees/api.js";
import { runClaudeDriver, runClaudeQaReview } from "./drivers/claude.js";
import { runGeminiDriver } from "./drivers/gemini.js";
import { runCodexDriver } from "./drivers/codex.js";
import { runMock } from "./drivers/mock.js";
import { invokeManager } from "./manager/invoke.js";
import { clearSessionId } from "./manager/session.js";
import { runPlanningDoc } from "./planning/dispatch.js";
import { createProject } from "./projects/create.js";
import { runConsult } from "./consult/run.js";
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

  // qa_review 상태는 ticket.role(원래 개발 담당자)이 아니라 그 팀의 QA 직원에게 보내야 한다 -
  // 서버가 이미 QA 직원 존재를 확인하고 이 상태로 보냈으므로 여기선 찾기만 하면 된다.
  if (ticket.status === "qa_review") {
    const qaEmployee = employees.find((e) => e.teamId === ticket.teamId && isQaEmployee(e.taskDescription));
    if (!qaEmployee) {
      console.log(`[runner] qa_review 티켓 ${ticket.id}에 맞는 QA 직원을 못 찾아 mock으로 대체합니다`);
      return runMock(ticket, send);
    }
    if (qaEmployee.driver !== "claude") {
      console.log(`[runner] QA 직원 드라이버(${qaEmployee.driver})는 아직 지원하지 않아 통과 처리합니다`);
      const { reportQaFallback } = await import("./employees/api.js");
      return reportQaFallback(ticket.id);
    }
    return runClaudeQaReview(ticket, qaEmployee, send);
  }

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

// 팀장이 create_planning_doc으로 위임하거나(최초) 사람이 수정 요청을 남기면(티키타카) 서버가
// 보낸다. 티켓 큐와는 별개 경로다.
async function handlePlanningDocAssign(event: {
  planningDocId: string;
  teamId: string;
  employeeName: string;
  message: string;
  resumeSessionId?: string;
}) {
  const employees = await fetchEmployees();
  const employee = employees.find((e) => e.name === event.employeeName);
  if (!employee) {
    send({
      type: "planning_doc_result",
      planningDocId: event.planningDocId,
      success: false,
      content: `"${event.employeeName}" 직원을 찾을 수 없습니다.`,
    });
    return;
  }
  return runPlanningDoc(event.planningDocId, employee, event.message, send, event.resumeSessionId);
}

// 브라우저 채팅바 -> 서버 -> 여기로 온다. 티켓 큐와는 별개 경로 (동시 실행 수 제한에 안 걸림).
// UI가 WS 이벤트를 놓치더라도(네트워크 끊김, 탭 백그라운드 등) 여기(러너 콘솔)에는 항상 전체
// 기록이 남는다 - "답변이 안 보이는데 뭐가 문제인지" 확인할 때는 이 터미널을 스크롤해서 보면 된다.
async function handleInvokeManager(requestId: string, teamId: string, message: string) {
  console.log(`[runner] manager 호출 시작 (team=${teamId}, requestId=${requestId})`);
  try {
    const result = await invokeManager(teamId, message, (line) => {
      console.log(`[manager:${teamId}] ${line}`);
      send({ type: "manager_log", teamId, requestId, line, ts: new Date().toISOString() });
    });
    console.log(
      `[runner] manager 호출 종료 (team=${teamId}, requestId=${requestId}, success=${result.success}): ${result.resultText}`
    );
    send({ type: "manager_result", teamId, requestId, resultText: result.resultText, success: result.success });
  } catch (err) {
    console.error(`[runner] manager 호출 실패 (team=${teamId}, requestId=${requestId})`, err);
    send({
      type: "manager_result",
      teamId,
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

// 팀장이 create_project로 새 프로젝트를 요청하면 서버가 보낸다. 실제 git clone/init/템플릿
// 복사는 호스트에서만 가능하다 (서버는 컨테이너 안이라 WORKSPACE_ROOT 실물 경로가 없다).
async function handleCreateProjectRequest(event: {
  requestId: string;
  name: string;
  gitUrl?: string;
  stack?: string;
}) {
  const result = await createProject(event.name, event.gitUrl, event.stack);
  send({
    type: "create_project_result",
    requestId: event.requestId,
    success: result.success,
    path: result.path,
    error: result.error,
  });
}

// 기획자가 ask_employee로 물어보면 서버가 이걸 보낸다. 실제 조사는 호스트(러너)에서만 가능하다
// (그 프로젝트의 실제 코드를 읽어야 하므로).
async function handleConsultEmployeeRequest(event: {
  requestId: string;
  employeeName: string;
  project: string;
  question: string;
}) {
  const employees = await fetchEmployees();
  const employee = employees.find((e) => e.name === event.employeeName);
  if (!employee) {
    send({
      type: "consult_employee_result",
      requestId: event.requestId,
      success: false,
      error: `"${event.employeeName}" 직원을 찾을 수 없습니다.`,
    });
    return;
  }
  const result = await runConsult(employee, event.project, event.question);
  send({
    type: "consult_employee_result",
    requestId: event.requestId,
    success: result.success,
    answer: result.answer,
    error: result.error,
  });
}

// 웹 UI의 "세션 종료" 버튼이 서버를 거쳐 여기로 보낸다. 이 팀의 --resume 대상을 지워서,
// 다음 팀장 호출이 완전히 새 세션으로 시작하게 한다.
async function handleEndSessionRequest(event: { requestId: string; teamId: string }) {
  try {
    await clearSessionId(event.teamId);
    send({ type: "end_session_result", requestId: event.requestId, success: true });
  } catch (err) {
    send({
      type: "end_session_result",
      requestId: event.requestId,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

const DRIVER_BINARIES: Record<string, string> = { claude: "claude", gemini: "gemini", codex: "codex" };

// 실행파일 이름으로 --version을 돌려본다. cross-spawn을 쓰는 이유: Windows에서 claude/gemini/codex는
// npm 전역 설치 시 진짜 실행파일이 아니라 .cmd 쉼(shim)이라서, node의 기본 spawn/execFile은
// shell: true 없이는 아예 시작도 못 시킨다 (그럼 실제로는 설치돼 있어도 "설치 안 됨"으로 잘못 나옴).
// cross-spawn이 플랫폼별로 이 문제를 알아서 처리해준다.
function checkOneDriver(bin: string): Promise<DriverStatus> {
  return new Promise((resolve) => {
    const child = spawn(bin, ["--version"]);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", (err) => resolve({ installed: false, versionOrError: err.message }));
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ installed: true, versionOrError: stdout.trim() });
      } else {
        resolve({ installed: false, versionOrError: stderr.trim() || `exit code ${code}` });
      }
    });
  });
}

// 웹 UI에서 직원을 추가할 때 "이 CLI가 이 컴퓨터(러너)에 설치돼 있나" 보여주기 위한 것. 설치
// 여부만 확인한다 - 로그인(OAuth) 여부는 브라우저에서 대신 눌러줄 수 있는 게 아니라서 실제로
// 티켓을 돌려봐야 알 수 있다 (인증 실패 시 job 로그에 에러가 그대로 보인다).
async function handleCheckDriverStatus(requestId: string) {
  const status: Record<string, DriverStatus> = {};
  for (const [driver, bin] of Object.entries(DRIVER_BINARIES)) {
    status[driver] = await checkOneDriver(bin);
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

// 터미널에서 직접 실행한 `claude --version`과, 이 러너 프로세스가 cross-spawn으로 resolve하는
// "claude"가 실제로 같은 실행파일인지 확인하기 위한 1회성 진단. PATH에 여러 버전이 잡혀있으면
// (nvm, 여러 node 설치본 등) 터미널과 spawn 경로가 서로 다른 걸 가리킬 수 있고, 그러면 오래된
// 버전이 --append-system-prompt-file/--mcp-config(파일)/--output-format stream-json을 몰라서
// 조용히 무시해버리는 문제로 이어질 수 있다 - 실제로 원인 불명의 "MCP 툴이 하나도 안 불림" 현상을
// 겪은 뒤 추가함.
// 팀장/직원/QA/기획 세션에 붙는 MCP 서버는 러너(호스트 프로세스)가 apps/server/dist/mcp/*.js를
// `node <경로>`로 직접 스폰한다 - 이건 도커 이미지 안의 dist가 아니라 호스트 파일시스템의
// dist다. `pnpm --filter @ai-crew/server build`를 호스트에서 한 번도 안 돌렸으면 이 파일들이
// 아예 존재한 적이 없는데, 그래도 러너/서버 자체는 멀쩡히 뜨고 claude 세션도 정상 종료돼서
// (MCP 서버 하나 연결 실패는 claude 입장에서 치명적 에러가 아니다) 겉으로는 아무 문제 없어
// 보인다 - 실제로 팀장이 list_projects/create_ticket을 전혀 못 쓰는 채로 동작하는 원인 불명
// 버그로 이어진 적이 있어서, 시작 시 미리 확인하고 크게 경고한다.
const REPO_ROOT_FOR_MCP_CHECK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MCP_ENTRY_FILES = ["server.js", "employee-server.js", "qa-server.js", "planning-server.js"];

function checkMcpServerBuild() {
  const mcpDir = join(REPO_ROOT_FOR_MCP_CHECK, "apps", "server", "dist", "mcp");
  const missing = MCP_ENTRY_FILES.filter((f) => !existsSync(join(mcpDir, f)));
  if (missing.length === 0) {
    console.log(`[runner] MCP 서버 빌드 확인됨 (${mcpDir})`);
    return;
  }
  console.error(
    `\n[runner] 경고: 다음 MCP 서버 파일이 없습니다 - ${missing.join(", ")} (경로: ${mcpDir})\n` +
      `팀장/직원이 list_projects/create_ticket 같은 MCP 툴을 전혀 못 쓰는 채로 조용히 동작합니다 ` +
      `(세션 자체는 정상 종료되어서 겉으로는 문제없어 보입니다). 아래 명령으로 호스트에도 빌드해주세요:\n` +
      `  pnpm --filter @ai-crew/shared build && pnpm --filter @ai-crew/server build\n`
  );
}

function logClaudeDiagnostics() {
  const versionCheck = spawn("claude", ["--version"]);
  let versionOut = "";
  versionCheck.stdout?.on("data", (c: Buffer) => (versionOut += c.toString()));
  versionCheck.on("error", (err) => console.error(`[runner] claude --version 실행 실패: ${err.message}`));
  versionCheck.on("close", () => {
    const helpCheck = spawn("claude", ["--help"]);
    let helpOut = "";
    helpCheck.stdout?.on("data", (c: Buffer) => (helpOut += c.toString()));
    helpCheck.on("close", () => {
      const supportsFileFlag = helpOut.includes("append-system-prompt-file") || helpOut.includes("append-system-prompt[-file]");
      console.log(
        `[runner] claude 진단: version=${versionOut.trim() || "(확인 실패)"}, ` +
          `--append-system-prompt-file 지원=${supportsFileFlag}`
      );
      if (!supportsFileFlag) {
        console.log(
          `[runner] 경고: 이 claude 실행파일은 --append-system-prompt-file을 모르는 것 같습니다. ` +
            `"where claude"(윈도우)/"which -a claude"로 PATH에 다른 버전이 잡혀있는지 확인해보세요.`
        );
      }
    });
  });
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
      handleInvokeManager(event.requestId, event.teamId, event.message);
    } else if (event.type === "merge_ticket") {
      handleMergeTicket(event);
    } else if (event.type === "check_driver_status") {
      handleCheckDriverStatus(event.requestId);
    } else if (event.type === "planning_doc_assign") {
      handlePlanningDocAssign(event);
    } else if (event.type === "create_project_request") {
      handleCreateProjectRequest(event);
    } else if (event.type === "consult_employee_request") {
      handleConsultEmployeeRequest(event);
    } else if (event.type === "end_session_request") {
      handleEndSessionRequest(event);
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

checkMcpServerBuild();
logClaudeDiagnostics();
connect();
