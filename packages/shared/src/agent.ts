// "gemini"(Gemini CLI)는 2026-06-18 서비스 종료로 "antigravity"(후속 CLI, 실행파일 agy)로
// 대체됐다. DB에 남은 driver="gemini" 행은 서버 부팅 시 자동으로 antigravity로 바뀐다
// (apps/server/src/employees/store.ts의 migrateLegacyGeminiDriver).
export type Driver = "claude" | "antigravity" | "codex" | "mock";

// 팀장(agents/manager.md) 전용 - 고정 파일 하나뿐이라 손으로 쓴 prompt를 그대로 들고 있다.
export interface AgentConfig {
  id: string;
  name: string;
  driver: Driver;
  model?: string;
  allowedTools: string[];
  requireApproval: string[];
  prompt: string;
}

// 웹에서 추가/삭제하는 직원. taskDescription으로부터 시스템 프롬프트를 매번 생성한다
// (runner/src/employees/prompt.ts) - 저장된 prompt 필드가 없다.
export interface Employee {
  id: string;
  teamId: string;
  name: string;
  driver: Driver;
  model?: string;
  taskDescription: string;
  // 이 직원이 담당하는 프로젝트(Team.projects 중 선택한 것들). 비어있으면 팀의 모든
  // 프로젝트를 담당한다는 뜻이다 - 이 필드가 생기기 전에 만들어진 직원이 그대로 동작한다.
  projects: string[];
  allowedTools: string[];
  requireApproval: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectInfo {
  name: string;
  path: string;
  isGitRepo: boolean;
  stackGuess: "spring-boot-gradle" | "node-react" | "unknown";
}
