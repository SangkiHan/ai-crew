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
import { summarizeDiff } from "../git.js";
import { projectPath } from "../workspace.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", ".."); // drivers -> src -> runner -> repo root
const EMPLOYEE_MCP_SERVER_ENTRY =
  process.env.EMPLOYEE_MCP_SERVER_ENTRY ?? join(REPO_ROOT, "apps", "server", "dist", "mcp", "employee-server.js");
const QA_MCP_SERVER_ENTRY =
  process.env.QA_MCP_SERVER_ENTRY ?? join(REPO_ROOT, "apps", "server", "dist", "mcp", "qa-server.js");
const AI_CREW_SERVER_URL = process.env.AI_CREW_SERVER_URL ?? "http://localhost:8080";

const EMPLOYEE_MCP_SERVER_NAME = "ai-crew-employee-tools";
const EMPLOYEE_TOOL_NAMES = ["report_blocked", "list_employees", "ask_peer", "answer_peer_message"].map(
  (tool) => `mcp__${EMPLOYEE_MCP_SERVER_NAME}__${tool}`
);

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

// 실제 Claude Code 직원.
export async function runClaudeDriver(
  ticket: Ticket,
  employee: Employee,
  send: (event: RunnerToServerEvent) => void
) {
  const { cwd, message, systemPrompt, baseSha } = await prepareEmployeeJob(ticket, employee, send);
  const now = () => new Date().toISOString();

  const result = await runClaudeHeadless({
    message,
    systemPrompt,
    allowedTools: [...employee.allowedTools, ...EMPLOYEE_TOOL_NAMES],
    disallowedTools: toDisallowedBashPatterns(employee.requireApproval),
    permissionMode: "acceptEdits",
    cwd,
    model: employee.model,
    mcpConfigJson: buildEmployeeMcpConfig(ticket.id, employee.name, employee.teamId),
    onSpawn: (pid) => writeDriverPid(ticket.id, pid),
    onEvent: (line) => {
      send({ type: "job_log", ticketId: ticket.id, line, ts: now() });
      send({ type: "job_heartbeat", ticketId: ticket.id, ts: now() });
    },
  });
  await clearDriverPid(ticket.id);

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
    systemPrompt: buildEmployeePrompt(employee.taskDescription),
    allowedTools: [...employee.allowedTools, ...EMPLOYEE_TOOL_NAMES],
    disallowedTools: toDisallowedBashPatterns(employee.requireApproval),
    permissionMode: "acceptEdits",
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

  await runClaudeHeadless({
    message,
    systemPrompt,
    allowedTools: ["Read", "Grep", "Glob", "Bash", ...QA_TOOL_NAMES],
    permissionMode: "acceptEdits",
    cwd,
    model: qaEmployee.model,
    mcpConfigJson: buildQaMcpConfig(ticket.id),
    onSpawn: (pid) => writeDriverPid(ticket.id, pid),
    onEvent: (line) => {
      send({ type: "job_log", ticketId: ticket.id, line, ts: now() });
      send({ type: "job_heartbeat", ticketId: ticket.id, ts: now() });
    },
  });
  await clearDriverPid(ticket.id);

  reportQaFallbackIfNeeded(ticket);
}
