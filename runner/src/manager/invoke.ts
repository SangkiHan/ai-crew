import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadAgentDefinition } from "../agents/load.js";
import { runClaudeHeadless } from "../claude/headless.js";
import { readSessionId, writeSessionId } from "./session.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", ".."); // manager -> src -> runner -> repo root

const AGENT_DEFINITION_PATH = process.env.MANAGER_AGENT_MD ?? join(REPO_ROOT, "agents", "manager.md");
const MCP_SERVER_ENTRY = process.env.MCP_SERVER_ENTRY ?? join(REPO_ROOT, "apps", "server", "dist", "mcp", "server.js");
const MANAGER_CWD = process.env.MANAGER_CWD ?? REPO_ROOT;
const AI_CREW_SERVER_URL = process.env.AI_CREW_SERVER_URL ?? "http://localhost:8080";
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT ?? join(homedir(), "Desktop", "Project");

const MCP_SERVER_NAME = "ai-crew-manager-tools";
const MCP_TOOL_NAMES = [
  "list_projects",
  "list_employees",
  "create_ticket",
  "create_project",
  "get_ticket",
  "list_tickets",
  "create_planning_doc",
  "search_history",
  "ask_user",
].map((tool) => `mcp__${MCP_SERVER_NAME}__${tool}`);

export interface ManagerResult {
  sessionId: string;
  resultText: string;
  success: boolean;
}

function buildMcpConfig(teamId: string): string {
  return JSON.stringify({
    mcpServers: {
      [MCP_SERVER_NAME]: {
        type: "stdio",
        command: "node",
        args: [MCP_SERVER_ENTRY],
        env: {
          AI_CREW_SERVER_URL,
          WORKSPACE_ROOT,
          TEAM_ID: teamId,
        },
      },
    },
  });
}

// 사용자 메시지(또는 직원의 blocked/report 이벤트)로 팀장을 깨운다. 어느 팀의 팀장인지는
// teamId로 구분된다 - 팀마다 대화 세션(--resume)과 MCP 툴이 보는 직원/티켓 범위가 분리된다.
// 팀장의 프롬프트(agents/manager.md) 자체는 모든 팀이 공유한다 - 내용이 팀마다 다르지 않다.
export async function invokeManager(
  teamId: string,
  message: string,
  onEvent?: (line: string) => void
): Promise<ManagerResult> {
  const agent = await loadAgentDefinition(AGENT_DEFINITION_PATH);
  const previousSessionId = await readSessionId(teamId);

  const result = await runClaudeHeadless({
    message,
    systemPrompt: agent.prompt,
    allowedTools: [...agent.allowedTools, ...MCP_TOOL_NAMES],
    permissionMode: "dontAsk",
    cwd: MANAGER_CWD,
    model: agent.model,
    resumeSessionId: previousSessionId ?? undefined,
    mcpConfigJson: buildMcpConfig(teamId),
    onEvent,
  });

  if (result.sessionId) await writeSessionId(teamId, result.sessionId);
  return result;
}
