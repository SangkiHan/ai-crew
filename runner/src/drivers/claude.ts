import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Employee, RunnerToServerEvent, Ticket } from "@ai-crew/shared";
import { runClaudeHeadless } from "../claude/headless.js";
import {
  prepareEmployeeJob,
  prepareQaJob,
  reportDriverResult,
  reportQaFallbackIfNeeded,
  toDisallowedBashPatterns,
} from "../employees/prepare.js";

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
  const { worktreePath, message, systemPrompt } = await prepareEmployeeJob(ticket, employee, send);
  const now = () => new Date().toISOString();

  const result = await runClaudeHeadless({
    message,
    systemPrompt,
    allowedTools: [...employee.allowedTools, ...EMPLOYEE_TOOL_NAMES],
    disallowedTools: toDisallowedBashPatterns(employee.requireApproval),
    permissionMode: "acceptEdits",
    cwd: worktreePath,
    model: employee.model,
    mcpConfigJson: buildEmployeeMcpConfig(ticket.id, employee.name, employee.teamId),
    onEvent: (line) => {
      send({ type: "job_log", ticketId: ticket.id, line, ts: now() });
      send({ type: "job_heartbeat", ticketId: ticket.id, ts: now() });
    },
  });

  reportDriverResult(ticket, employee, result, send);
}

// QA 검증 세션. 개발자가 쓴 워크트리를 그대로 재사용하고(prepareQaJob), 코드 수정 툴은 안 준다 -
// 판정은 report_qa_result 툴로 REST에 직접 남기므로(report_blocked와 같은 패턴), 세션이 끝나도
// 이 함수는 티켓 상태를 직접 바꾸지 않는다. 세션이 그 툴을 안 부르고 끝났을 때만 안전망으로
// 통과 처리한다.
export async function runClaudeQaReview(
  ticket: Ticket,
  qaEmployee: Employee,
  send: (event: RunnerToServerEvent) => void
) {
  const { worktreePath, message, systemPrompt } = await prepareQaJob(ticket, qaEmployee, send);
  const now = () => new Date().toISOString();

  await runClaudeHeadless({
    message,
    systemPrompt,
    allowedTools: ["Read", "Grep", "Glob", "Bash", ...QA_TOOL_NAMES],
    permissionMode: "acceptEdits",
    cwd: worktreePath,
    model: qaEmployee.model,
    mcpConfigJson: buildQaMcpConfig(ticket.id),
    onEvent: (line) => {
      send({ type: "job_log", ticketId: ticket.id, line, ts: now() });
      send({ type: "job_heartbeat", ticketId: ticket.id, ts: now() });
    },
  });

  reportQaFallbackIfNeeded(ticket);
}
