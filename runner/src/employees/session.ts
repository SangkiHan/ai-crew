import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// 직원 세션 재사용 저장소. 티켓마다 새 세션을 띄우면 같은 직원이 같은 프로젝트를 맡아도
// 매번 프로젝트 구조/컨벤션 분석을 처음부터 다시 해서 토큰(사용량 한도)이 중복으로 소진된다 -
// (팀, 직원, 프로젝트) 단위로 마지막 Claude 세션 id를 기억해뒀다가 다음 티켓에서 --resume으로
// 이어간다. 매니저 세션(manager/session.ts)과 같은 파일 기반 패턴이다.
const SESSION_FILE =
  process.env.EMPLOYEE_SESSION_FILE ?? join(homedir(), ".ai-crew", "employee-sessions.json");

// 프로젝트를 절대경로로 쓰든 이름만 쓰든 같은 키로 모으기 위해 마지막 경로 세그먼트를
// 소문자로 정규화한다 - 서버의 projectKey(apps/server/src/tickets/store.ts)와 같은 규칙.
function projectKeyOf(project: string): string {
  const parts = project.split(/[\\/]/).filter(Boolean);
  return (parts[parts.length - 1] ?? project).toLowerCase();
}

function sessionKey(teamId: string, employeeName: string, project: string): string {
  return `${teamId}|${employeeName}|${projectKeyOf(project)}`;
}

async function readSessionMap(): Promise<Record<string, string>> {
  try {
    const raw = await readFile(SESSION_FILE, "utf-8");
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

async function writeSessionMap(map: Record<string, string>): Promise<void> {
  await mkdir(dirname(SESSION_FILE), { recursive: true });
  await writeFile(SESSION_FILE, JSON.stringify(map, null, 2));
}

export async function readEmployeeSessionId(
  teamId: string,
  employeeName: string,
  project: string
): Promise<string | null> {
  const map = await readSessionMap();
  return map[sessionKey(teamId, employeeName, project)] ?? null;
}

export async function writeEmployeeSessionId(
  teamId: string,
  employeeName: string,
  project: string,
  sessionId: string
): Promise<void> {
  if (!sessionId) return;
  const map = await readSessionMap();
  map[sessionKey(teamId, employeeName, project)] = sessionId;
  await writeSessionMap(map);
}

// 저장된 세션이 CLI 쪽에서 사라져(오래돼 정리됨 등) resume이 실패했을 때 지운다 -
// 다음 실행이 깨끗하게 새 세션으로 시작하게.
export async function clearEmployeeSessionId(
  teamId: string,
  employeeName: string,
  project: string
): Promise<void> {
  const map = await readSessionMap();
  delete map[sessionKey(teamId, employeeName, project)];
  await writeSessionMap(map);
}

// 웹 UI의 "세션 종료" 전용. 팀장 세션만 리셋하고 직원 세션이 남으면 팀의 기억이 반만 지워진다 -
// 팀장은 백지인데 직원은 지난 대화를 기억한 채로 다음 티켓을 받는 어긋난 상태가 되므로,
// 같은 팀의 직원 세션(키 접두어 "teamId|")을 전부 함께 지운다.
export async function clearEmployeeSessionsForTeam(teamId: string): Promise<void> {
  const map = await readSessionMap();
  const prefix = `${teamId}|`;
  let changed = false;
  for (const key of Object.keys(map)) {
    if (key.startsWith(prefix)) {
      delete map[key];
      changed = true;
    }
  }
  if (changed) await writeSessionMap(map);
}
