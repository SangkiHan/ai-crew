import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Employee, RunnerToServerEvent, Ticket } from "@ai-crew/shared";
import { runClaudeHeadless } from "../claude/headless.js";
import {
  clearDriverPid,
  prepareEmployeeJob,
  prepareQaJob,
  reportDriverResult,
  reportQaFallbackIfNeeded,
  toDisallowedBashPatterns,
  writeDriverPid,
} from "../employees/prepare.js";
import { buildEmployeePrompt } from "../employees/prompt.js";
import {
  clearEmployeeSessionId,
  readEmployeeSessionId,
  writeEmployeeSessionId,
} from "../employees/session.js";
import { summarizeDiff } from "../git.js";
import { projectPath } from "../workspace.js";

// 이전 티켓 세션을 이어받았을 때 티켓 지시 앞에 붙는 안내. 세션 기억은 "그때의 코드" 기준이라
// 그 사이 사람이나 다른 직원이 바꾼 부분과 어긋날 수 있다 - 기억을 인덱스로만 쓰고 실물을
// 다시 확인하게 한다.
const RESUMED_SESSION_NOTE =
  "## 참고: 이전 티켓들과 같은 세션을 이어서 작업합니다\n" +
  "이 프로젝트에 대해 이미 알고 있는 내용(구조, 컨벤션, 지난 작업)을 다시 조사할 필요는 없습니다. " +
  "단, 세션 기억은 그때의 코드 기준입니다 - 그 사이 다른 사람이 수정했을 수 있으니, 이번 작업에서 " +
  "다루는 파일은 기억에 의존하지 말고 실제 내용을 확인하고 진행하세요.\n\n---\n\n";

// 저장해둔 세션이 CLI 쪽에서 이미 정리된 경우 claude가 이 문구를 내며 빠르게 실패한다 -
// 이때만 세션을 버리고 새로 시작하는 폴백을 태운다 (일반 작업 실패와 구분).
function isSessionNotFound(resultText: string): boolean {
  return /no conversation found/i.test(resultText);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", ".."); // drivers -> src -> runner -> repo root
const EMPLOYEE_MCP_SERVER_ENTRY =
  process.env.EMPLOYEE_MCP_SERVER_ENTRY ?? join(REPO_ROOT, "apps", "server", "dist", "mcp", "employee-server.js");
const QA_MCP_SERVER_ENTRY =
  process.env.QA_MCP_SERVER_ENTRY ?? join(REPO_ROOT, "apps", "server", "dist", "mcp", "qa-server.js");
const AI_CREW_SERVER_URL = process.env.AI_CREW_SERVER_URL ?? "http://localhost:8080";

const EMPLOYEE_MCP_SERVER_NAME = "ai-crew-employee-tools";
const EMPLOYEE_TOOL_NAMES = [
  "report_blocked",
  "list_employees",
  "ask_peer",
  "ask_employee",
  "answer_peer_message",
].map((tool) => `mcp__${EMPLOYEE_MCP_SERVER_NAME}__${tool}`);

const QA_MCP_SERVER_NAME = "ai-crew-qa-tools";
const QA_TOOL_NAMES = ["report_qa_result"].map((tool) => `mcp__${QA_MCP_SERVER_NAME}__${tool}`);

function buildEmployeeMcpConfig(ticketId: string, employeeName: string, teamId: string): string {
  return JSON.stringify({
    mcpServers: {
      [EMPLOYEE_MCP_SERVER_NAME]: {
        type: "stdio",
        command: "node",
        args: [EMPLOYEE_MCP_SERVER_ENTRY],
        env: { TICKET_ID: ticketId, EMPLOYEE_NAME: employeeName, TEAM_ID: teamId, AI_CREW_SERVER_URL },
      },
    },
  });
}

function buildQaMcpConfig(ticketId: string): string {
  return JSON.stringify({
    mcpServers: {
      [QA_MCP_SERVER_NAME]: {
        type: "stdio",
        command: "node",
        args: [QA_MCP_SERVER_ENTRY],
        env: { TICKET_ID: ticketId, AI_CREW_SERVER_URL },
      },
    },
  });
}

// 실제 Claude Code 직원. 같은 (직원, 프로젝트)의 이전 티켓 세션이 있으면 --resume으로
// 이어간다 - 매 티켓마다 프로젝트 분석을 처음부터 다시 하느라 토큰이 중복 소진되는 걸 막는다.
export async function runClaudeDriver(
  ticket: Ticket,
  employee: Employee,
  send: (event: RunnerToServerEvent) => void
) {
  const { cwd, message, systemPrompt, baseSha } = await prepareEmployeeJob(ticket, employee, send);
  const now = () => new Date().toISOString();

  const previousSessionId = await readEmployeeSessionId(employee.teamId, employee.name, ticket.project);
  if (previousSessionId) {
    send({
      type: "job_log",
      ticketId: ticket.id,
      line: `[${employee.name}] 이전 세션을 이어서 시작합니다 (프로젝트 분석 재사용)`,
      ts: now(),
    });
  }

  const run = (resumeSessionId?: string) =>
    runClaudeHeadless({
      message: resumeSessionId ? RESUMED_SESSION_NOTE + message : message,
      systemPrompt,
      allowedTools: [...employee.allowedTools, ...EMPLOYEE_TOOL_NAMES],
      disallowedTools: toDisallowedBashPatterns(employee.requireApproval),
      // acceptEdits는 이름 그대로 "편집(기존 파일 수정)"만 자동 승인하고, 새 파일 생성(Write) 같은
      // 동작은 비대화형 세션에서 프롬프트를 띄울 수 없어 조용히 거부되는 걸로 보인다 - 직원이
      // "새 파일을 만들어야 하는데 비대화형 세션이라 쓰기 권한이 없다"고 스스로 보고한 사고가
      // 실제로 있었다(사용자 확인 후 변경). bypassPermissions로 승인 절차 자체를 건너뛴다 -
      // allowedTools/disallowedTools는 승인 여부와 무관한 별도의 하드 필터라 git push/rm 차단은
      // 그대로 유지된다.
      permissionMode: "bypassPermissions",
      cwd,
      model: employee.model,
      resumeSessionId,
      mcpConfigJson: buildEmployeeMcpConfig(ticket.id, employee.name, employee.teamId),
      onSpawn: (pid) => writeDriverPid(ticket.id, pid),
      onEvent: (line) => {
        send({ type: "job_log", ticketId: ticket.id, line, ts: now() });
        send({ type: "job_heartbeat", ticketId: ticket.id, ts: now() });
      },
    });

  let result = await run(previousSessionId ?? undefined);

  // 저장된 세션이 CLI 쪽에서 이미 정리돼 resume이 실패한 경우(작업 시작 전에 빠르게 실패하므로
  // 중복 작업 위험이 없다)에만 세션을 버리고 새로 한 번 다시 시작한다.
  if (!result.success && previousSessionId && isSessionNotFound(result.resultText)) {
    send({
      type: "job_log",
      ticketId: ticket.id,
      line: `[${employee.name}] 이전 세션을 찾을 수 없어 새 세션으로 다시 시작합니다`,
      ts: now(),
    });
    await clearEmployeeSessionId(employee.teamId, employee.name, ticket.project);
    result = await run(undefined);
  }

  await clearDriverPid(ticket.id);
  // 실패한 세션도 저장한다 - 세션 자체는 살아있고, 재시도 티켓에서 "지난번에 왜 실패했는지"를
  // 기억한 채 이어가는 게 오히려 유리하다.
  await writeEmployeeSessionId(employee.teamId, employee.name, ticket.project, result.sessionId);

  const diffSummary = await summarizeDiff(cwd, baseSha);
  reportDriverResult(ticket, employee, result, send, diffSummary);
}

// review 티켓에 사람이 남긴 수정 요청. 프로젝트 실제 폴더에서 그대로 이어서 작업하며,
// ticket.sessionId로 원래 담당 직원의 Claude Code 세션을 --resume해서 이어간다 - 담당
// 직원이 방금 뭘 했는지 전부 기억한 채로 수정사항만 반영한다(기획서 티키타카와 같은 패턴).
export async function runClaudeReviseDriver(
  ticket: Ticket,
  employee: Employee,
  message: string,
  send: (event: RunnerToServerEvent) => void
): Promise<void> {
  const cwd = projectPath(ticket.project);
  const now = () => new Date().toISOString();

  send({
    type: "job_log",
    ticketId: ticket.id,
    line: `[${employee.name}] 수정 요청 반영 시작 (이전 세션 이어서): ${message}`,
    ts: now(),
  });

  const result = await runClaudeHeadless({
    message,
    systemPrompt: buildEmployeePrompt(employee),
    allowedTools: [...employee.allowedTools, ...EMPLOYEE_TOOL_NAMES],
    disallowedTools: toDisallowedBashPatterns(employee.requireApproval),
    permissionMode: "bypassPermissions",
    cwd,
    model: employee.model,
    resumeSessionId: ticket.sessionId ?? undefined,
    mcpConfigJson: buildEmployeeMcpConfig(ticket.id, employee.name, employee.teamId),
    onSpawn: (pid) => writeDriverPid(ticket.id, pid),
    onEvent: (line) => {
      send({ type: "job_log", ticketId: ticket.id, line, ts: now() });
      send({ type: "job_heartbeat", ticketId: ticket.id, ts: now() });
    },
  });
  await clearDriverPid(ticket.id);

  // 수정 요청도 같은 세션 체인의 연장이다 - 직원 세션 저장소를 갱신해 다음 티켓이 이어받게 한다.
  await writeEmployeeSessionId(employee.teamId, employee.name, ticket.project, result.sessionId);

  const diffSummary = await summarizeDiff(cwd, ticket.baseSha);
  reportDriverResult(ticket, employee, result, send, diffSummary);
}

// QA 검증 세션. 개발자가 작업한 것과 같은 프로젝트 실제 폴더를 그대로 재사용하고(prepareQaJob),
// 코드 수정 툴은 안 준다 - 판정은 report_qa_result 툴로 REST에 직접 남기므로(report_blocked와
// 같은 패턴), 세션이 끝나도 이 함수는 티켓 상태를 직접 바꾸지 않는다. 세션이 그 툴을 안 부르고
// 끝났을 때만 안전망으로 통과 처리한다.
export async function runClaudeQaReview(
  ticket: Ticket,
  qaEmployee: Employee,
  send: (event: RunnerToServerEvent) => void
) {
  const { cwd, message, systemPrompt } = await prepareQaJob(ticket, qaEmployee, send);
  const now = () => new Date().toISOString();

  // QA도 같은 프로젝트를 반복 검증하므로 (QA 직원, 프로젝트) 세션을 재사용한다 - 매 검증마다
  // 프로젝트 구조 파악을 다시 하지 않는다. 키가 직원 이름 기준이라 개발자 세션과는 자연히 분리된다.
  const previousSessionId = await readEmployeeSessionId(qaEmployee.teamId, qaEmployee.name, ticket.project);

  const run = (resumeSessionId?: string) =>
    runClaudeHeadless({
      message: resumeSessionId ? RESUMED_SESSION_NOTE + message : message,
      systemPrompt,
      allowedTools: ["Read", "Grep", "Glob", "Bash", ...QA_TOOL_NAMES],
      permissionMode: "bypassPermissions",
      cwd,
      model: qaEmployee.model,
      resumeSessionId,
      mcpConfigJson: buildQaMcpConfig(ticket.id),
      onSpawn: (pid) => writeDriverPid(ticket.id, pid),
      onEvent: (line) => {
        send({ type: "job_log", ticketId: ticket.id, line, ts: now() });
        send({ type: "job_heartbeat", ticketId: ticket.id, ts: now() });
      },
    });

  let result = await run(previousSessionId ?? undefined);
  if (!result.success && previousSessionId && isSessionNotFound(result.resultText)) {
    await clearEmployeeSessionId(qaEmployee.teamId, qaEmployee.name, ticket.project);
    result = await run(undefined);
  }

  await clearDriverPid(ticket.id);
  await writeEmployeeSessionId(qaEmployee.teamId, qaEmployee.name, ticket.project, result.sessionId);

  reportQaFallbackIfNeeded(ticket);
}
