export type Driver = "claude" | "gemini" | "codex" | "mock";

export interface AgentConfig {
  id: string;
  name: string;
  driver: Driver;
  model?: string;
  projects: string[];
  allowedTools: string[];
  requireApproval: string[];
  prompt: string;
}

export interface ProjectInfo {
  name: string;
  path: string;
  isGitRepo: boolean;
  stackGuess: "spring-boot-gradle" | "node-react" | "unknown";
}
