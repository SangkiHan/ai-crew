import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { AgentConfig } from "@ai-crew/shared";
import { loadAgentDefinition } from "./load.js";

// 로컬 dev(cwd=apps/server)와 Docker(WORKDIR /repo/apps/server, agents/는 바인드 마운트) 양쪽에서
// ../../agents 가 저장소 루트의 agents/ 를 가리킨다.
const AGENTS_DIR = process.env.AGENTS_DIR ?? join(process.cwd(), "..", "..", "agents");

// 캐시하지 않고 매 요청마다 새로 읽는다 - 직원 정의 파일을 추가/수정해도 서버 재시작이 필요 없게.
export async function listAllAgents(): Promise<AgentConfig[]> {
  const files = await readdir(AGENTS_DIR);
  const agents: AgentConfig[] = [];
  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    agents.push(await loadAgentDefinition(join(AGENTS_DIR, file)));
  }
  return agents;
}
