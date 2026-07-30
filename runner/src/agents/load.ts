import { readFile } from "node:fs/promises";
import yaml from "js-yaml";
import type { AgentConfig } from "@ai-crew/shared";

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;

// agents/*.md: YAML 프론트매터(id/driver/projects/allowedTools/...) + 본문(시스템 프롬프트)
export async function loadAgentDefinition(path: string): Promise<AgentConfig> {
  const raw = await readFile(path, "utf-8");
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) throw new Error(`${path}: 프론트매터(---)를 찾을 수 없습니다`);
  const [, frontmatter, body] = match;
  const meta = yaml.load(frontmatter) as Omit<AgentConfig, "prompt">;
  return { ...meta, prompt: body.trim() };
}
