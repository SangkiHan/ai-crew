import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import type { Driver } from "@ai-crew/shared";
import { loadAgentDefinition } from "../agents/load.js";
import { fetchTeams } from "../employees/api.js";
import { runManagerAntigravity, runManagerClaude, runManagerCodex, type ManagerResult } from "./drivers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", ".."); // manager -> src -> runner -> repo root

const AGENT_DEFINITION_PATH = process.env.MANAGER_AGENT_MD ?? join(REPO_ROOT, "agents", "manager.md");
const MCP_SERVER_ENTRY = process.env.MCP_SERVER_ENTRY ?? join(REPO_ROOT, "apps", "server", "dist", "mcp", "server.js");
const AI_CREW_SERVER_URL = process.env.AI_CREW_SERVER_URL ?? "http://localhost:8080";
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT ?? join(homedir(), "Desktop", "Project");

const MCP_SERVER_NAME = "ai-crew-manager-tools";
// claude 전용: --allowedTools에 붙이는 mcp__서버__툴 이름 목록. antigravity/codex는 이런 개별
// 툴 화이트리스트 플래그가 없다 - MCP 서버를 붙이면 그 서버의 모든 툴을 그대로 쓸 수 있다
// (drivers.ts의 runManagerAntigravity/runManagerCodex 참고).
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
  "schedule_ticket_retry",
].map((tool) => `mcp__${MCP_SERVER_NAME}__${tool}`);

export type { ManagerResult };

function buildClaudeMcpConfig(teamId: string): string {
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

// 팀에 등록된 담당 프로젝트 목록을 시스템 프롬프트에 그대로 박아 넣는다. list_projects MCP
// 툴이 (연결 문제 등으로) 안 붙어도, 팀장이 자기 담당 프로젝트가 뭔지는 확실히 알 수 있게 하는
// 이중 안전장치 - 정적 텍스트라 MCP 연결 여부와 무관하게 항상 전달된다.
function buildProjectsNote(projects: string[]): string {
  if (projects.length === 0) return "";
  const list = projects.map((p) => `- ${p}`).join("\n");
  return `\n\n## 이 팀이 담당하는 프로젝트\n(list_projects로 다시 찾을 필요 없이, 아래 목록을 우선 신뢰하세요)\n${list}`;
}

// 사용자 메시지(또는 직원의 blocked/report 이벤트)로 팀장을 깨운다. 어느 팀의 팀장인지는
// teamId로 구분된다 - 팀마다 대화 세션(claude만 --resume)과 MCP 툴이 보는 직원/티켓 범위가
// 분리된다. 팀장의 프롬프트(agents/manager.md) 자체는 모든 팀이 공유한다 - 내용이 팀마다
// 다르지 않다. 실행 CLI(driver)와 모델은 팀 설정(웹 UI)에서 직원처럼 팀마다 고를 수 있다.
export async function invokeManager(
  teamId: string,
  message: string,
  onEvent?: (line: string) => void
): Promise<ManagerResult> {
  const agent = await loadAgentDefinition(AGENT_DEFINITION_PATH);
  // 팀 조회 실패해도 팀장 호출 자체를 막지 않는다 - 담당 프로젝트 안내가 빠지고
  // 드라이버/모델은 agents/manager.md 기본값(claude)으로 대체될 뿐이다.
  const team = await fetchTeams()
    .then((teams) => teams.find((t) => t.id === teamId))
    .catch(() => undefined);
  const systemPrompt = agent.prompt + buildProjectsNote(team?.projects ?? []);
  const driver: Driver = team?.managerDriver ?? "claude";
  const model = team?.managerModel ?? agent.model;

  switch (driver) {
    case "antigravity":
      return runManagerAntigravity(teamId, message, systemPrompt, model, onEvent);
    case "codex":
      return runManagerCodex(teamId, message, systemPrompt, model, onEvent);
    case "claude":
    default:
      return runManagerClaude(
        teamId,
        message,
        systemPrompt,
        [...agent.allowedTools, ...MCP_TOOL_NAMES],
        model,
        buildClaudeMcpConfig(teamId),
        onEvent
      );
  }
}
