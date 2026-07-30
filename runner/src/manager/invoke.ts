import { dirname, join } from "node:path";
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
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT ?? join(process.env.HOME ?? "", "Desktop/Project");

const MCP_SERVER_NAME = "ai-crew-manager-tools";
const MCP_TOOL_NAMES = ["list_projects", "create_ticket", "get_ticket", "list_tickets", "ask_user"].map(
  (tool) => `mcp__${MCP_SERVER_NAME}__${tool}`
);

export interface ManagerResult {
  sessionId: string;
  resultText: string;
  success: boolean;
}

function buildMcpConfig(): string {
  return JSON.stringify({
    mcpServers: {
      [MCP_SERVER_NAME]: {
        type: "stdio",
        command: "node",
        args: [MCP_SERVER_ENTRY],
        env: {
          AI_CREW_SERVER_URL,
          WORKSPACE_ROOT,
        },
      },
    },
  });
}

// 사용자 메시지(또는 직원의 blocked/report 이벤트)로 팀장을 깨운다.
// 세션이 있으면 --resume으로 이어가고, 없으면 새로 시작한다.
export async function invokeManager(
  message: string,
  onEvent?: (line: string) => void
): Promise<ManagerResult> {
  const agent = await loadAgentDefinition(AGENT_DEFINITION_PATH);
  const previousSessionId = await readSessionId();

  const result = await runClaudeHeadless({
    message,
    systemPrompt: agent.prompt,
    allowedTools: [...agent.allowedTools, ...MCP_TOOL_NAMES],
    permissionMode: "dontAsk",
    cwd: MANAGER_CWD,
    resumeSessionId: previousSessionId ?? undefined,
    mcpConfigJson: buildMcpConfig(),
    onEvent,
  });

  if (result.sessionId) await writeSessionId(result.sessionId);
  return result;
}
