import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const SESSION_FILE =
  process.env.MANAGER_SESSION_FILE ?? join(process.env.HOME ?? ".", ".ai-crew", "manager-session.json");

export async function readSessionId(): Promise<string | null> {
  try {
    const raw = await readFile(SESSION_FILE, "utf-8");
    const parsed = JSON.parse(raw) as { sessionId?: string };
    return parsed.sessionId ?? null;
  } catch {
    return null;
  }
}

export async function writeSessionId(sessionId: string): Promise<void> {
  await mkdir(dirname(SESSION_FILE), { recursive: true });
  await writeFile(SESSION_FILE, JSON.stringify({ sessionId }, null, 2));
}
