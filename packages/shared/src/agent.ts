export type Driver = "claude" | "gemini" | "codex" | "mock";

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
