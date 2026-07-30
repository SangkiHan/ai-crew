import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Employee, RunnerToServerEvent, Ticket } from "@ai-crew/shared";
import { runClaudeHeadless } from "../claude/headless.js";
import { prepareEmployeeJob, reportDriverResult, toDisallowedBashPatterns } from "../employees/prepare.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", ".."); // drivers -> src -> runner -> repo root
const EMPLOYEE_MCP_SERVER_ENTRY =
  process.env.EMPLOYEE_MCP_SERVER_ENTRY ?? join(REPO_ROOT, "apps", "server", "dist", "mcp", "employee-server.js");
const AI_CREW_SERVER_URL = process.env.AI_CREW_SERVER_URL ?? "http://localhost:8080";

const EMPLOYEE_MCP_SERVER_NAME = "ai-crew-employee-tools";
const EMPLOYEE_TOOL_NAMES = ["report_blocked", "list_employees", "ask_peer", "answer_peer_message"].map(
  (tool) => `mcp__${EMPLOYEE_MCP_SERVER_NAME}__${tool}`
);

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
