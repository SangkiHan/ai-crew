import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAgentDefinition } from "../agents/load.js";
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
  events: unknown[];
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
export async function invokeManager(message: string): Promise<ManagerResult> {
  const agent = await loadAgentDefinition(AGENT_DEFINITION_PATH);
  const previousSessionId = await readSessionId();

  const allowedTools = [...agent.allowedTools, ...MCP_TOOL_NAMES].join(",");

  const args = [
    "-p",
    message,
    "--output-format",
    "stream-json",
    "--verbose",
    "--mcp-config",
    buildMcpConfig(),
    "--permission-mode",
    "dontAsk",
    "--allowedTools",
    allowedTools,
    "--append-system-prompt",
    agent.prompt,
  ];
  if (previousSessionId) {
    args.push("--resume", previousSessionId);
  }

  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { cwd: MANAGER_CWD });

    let buffer = "";
    let stderr = "";
    let sessionId = previousSessionId ?? "";
    let resultText = "";
    const events: unknown[] = [];

    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          events.push(event);
          if (typeof event.session_id === "string") sessionId = event.session_id;
          if (event.type === "result" && typeof event.result === "string") {
            resultText = event.result;
          }
        } catch {
          // stream-json 라인 파싱 실패 - 부분 라인일 수 있으니 무시
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);

    child.on("close", async (code) => {
      if (sessionId) await writeSessionId(sessionId);
      if (code === 0) {
        resolve({ sessionId, resultText, events });
      } else {
        reject(new Error(`claude exited with code ${code}: ${stderr || "(stderr 없음)"}`));
      }
    });
  });
}
