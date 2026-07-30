import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentConfig } from "@ai-crew/shared";
import { loadAgentDefinition } from "./load.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", ".."); // agents -> src -> runner -> repo root
const AGENTS_DIR = process.env.AGENTS_DIR ?? join(REPO_ROOT, "agents");

// manager.md는 티켓 큐로 배정되는 대상이 아니라 별도(runner/src/manager)로 호출되므로 제외한다.
export async function loadEmployeeAgents(): Promise<Map<string, AgentConfig>> {
  const files = await readdir(AGENTS_DIR);
  const map = new Map<string, AgentConfig>();
  for (const file of files) {
    if (!file.endsWith(".md") || file === "manager.md") continue;
    const agent = await loadAgentDefinition(join(AGENTS_DIR, file));
    map.set(agent.id, agent);
  }
  return map;
}
