import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadAgentDefinition } from "../agents/load.js";
import { runClaudeHeadless } from "../claude/headless.js";
import { fetchTeams } from "../employees/api.js";
import { projectPath } from "../workspace.js";
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

// 팀에 등록된 담당 프로젝트 목록을 시스템 프롬프트에 그대로 박아 넣고(list_projects MCP 툴이
// 연결 문제 등으로 안 붙어도 팀장이 자기 담당 프로젝트를 확실히 알 수 있는 이중 안전장치),
// 동시에 그 프로젝트들의 실제 절대경로를 --add-dir로 열어줄 목록도 함께 계산한다. 사용자 결정:
// 프론트+백엔드처럼 여러 프로젝트에 걸친 요청을 받으면 팀장이 직접 양쪽 실제 코드를 읽고 API
// 계약(필드명/타입/엔드포인트)을 설계해서 두 티켓에 동일하게 못 박아줄 수 있어야 한다 - 순서대로
// (백엔드 먼저 완료 후 프론트) 시키면 시간이 배로 걸리므로, 대신 팀장이 미리 설계하고 양쪽에
// 동시에 위임하는 쪽을 택했다.
async function buildProjectsContext(teamId: string): Promise<{ note: string; addDirs: string[] }> {
  try {
    const teams = await fetchTeams();
    const team = teams.find((t) => t.id === teamId);
    if (!team || team.projects.length === 0) return { note: "", addDirs: [] };
    const list = team.projects.map((p) => `- ${p}`).join("\n");
    const note = `\n\n## 이 팀이 담당하는 프로젝트\n(list_projects로 다시 찾을 필요 없이, 아래 목록을 우선 신뢰하세요)\n${list}`;
    const addDirs = team.projects.map((p) => projectPath(p));
    return { note, addDirs };
  } catch {
    return { note: "", addDirs: [] }; // 서버 조회 실패해도 팀장 호출 자체를 막지는 않는다.
  }
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
  const { note: projectsNote, addDirs } = await buildProjectsContext(teamId);

  const result = await runClaudeHeadless({
    message,
    systemPrompt: agent.prompt + projectsNote,
    allowedTools: [...agent.allowedTools, ...MCP_TOOL_NAMES],
    permissionMode: "dontAsk",
    cwd: MANAGER_CWD,
    model: agent.model,
    resumeSessionId: previousSessionId ?? undefined,
    mcpConfigJson: buildMcpConfig(teamId),
    addDirs,
    onEvent,
  });

  if (result.sessionId) await writeSessionId(teamId, result.sessionId);
  return result;
}
