import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const SESSION_FILE =
  process.env.MANAGER_SESSION_FILE ?? join(homedir(), ".ai-crew", "manager-session.json");

// 팀마다 팀장 대화(세션)가 분리되어야 해서 teamId -> sessionId 맵으로 저장한다.
// 여러 팀 기능 이전에는 { sessionId } 단일 값이었는데, 이제 { [teamId]: sessionId } 형태다.
async function readSessionMap(): Promise<Record<string, string>> {
  try {
    const raw = await readFile(SESSION_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, string> | { sessionId?: string };
    if (parsed && typeof parsed === "object" && "sessionId" in parsed) {
      return {}; // 예전 단일-세션 포맷 - 팀 구분이 없어 그냥 버리고 새로 시작한다.
    }
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

export async function readSessionId(teamId: string): Promise<string | null> {
  const map = await readSessionMap();
  return map[teamId] ?? null;
}

export async function writeSessionId(teamId: string, sessionId: string): Promise<void> {
  const map = await readSessionMap();
  map[teamId] = sessionId;
  await mkdir(dirname(SESSION_FILE), { recursive: true });
  await writeFile(SESSION_FILE, JSON.stringify(map, null, 2));
}

// 웹 UI의 "세션 종료" 버튼 전용. 이 팀의 --resume 대상을 지워서, 다음 팀장 호출이 완전히
// 새 세션으로 시작하게 한다 (이전 대화를 더 이상 기억하지 않음).
export async function clearSessionId(teamId: string): Promise<void> {
  const map = await readSessionMap();
  delete map[teamId];
  await mkdir(dirname(SESSION_FILE), { recursive: true });
  await writeFile(SESSION_FILE, JSON.stringify(map, null, 2));
}
