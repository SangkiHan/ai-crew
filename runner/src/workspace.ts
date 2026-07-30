import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT ?? join(homedir(), "Desktop", "Project");

// project가 절대경로면 그대로 쓴다 - WORKSPACE_ROOT 밖의 프로젝트도 사용자가 경로를 알려주면
// 티켓의 project 값으로 그대로 넘어온다 (팀장 MCP 툴 create_ticket 설명 참고).
export function projectPath(project: string): string {
  if (isAbsolute(project)) return project;
  return join(WORKSPACE_ROOT, project);
}
