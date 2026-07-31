import { execFile } from "node:child_process";
import { mkdir, access, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { ticketBranchName } from "@ai-crew/shared";

const execFileAsync = promisify(execFile);

// 워크트리를 만든 시점의 브랜치 시작점(base) 커밋을 이 파일에 남겨둔다. 승인 직전에
// "이 티켓이 실제로 커밋을 만들었는지"(diffStat)를 계산하려면 base가 있어야 하는데, 수정
// 요청(revise) 흐름은 워크트리를 새로 만들지 않고 재사용하므로 그때도 다시 읽을 수 있어야
// 한다 - DB 컬럼 대신 워크트리 안 파일로 두면 두 흐름(최초 실행/revise) 모두 같은 코드로 처리된다.
function baseShaFile(worktreePath: string): string {
  return join(worktreePath, ".ai-crew-base-sha");
}

export async function readBaseSha(worktreePath: string): Promise<string | null> {
  try {
    return (await readFile(baseShaFile(worktreePath), "utf-8")).trim() || null;
  } catch {
    return null;
  }
}

const WORKTREES_ROOT = process.env.WORKTREES_ROOT ?? join(homedir(), ".ai-crew", "worktrees");

export interface Worktree {
  branch: string;
  worktreePath: string;
}

// project는 WORKSPACE_ROOT 아래 이름(예: "puppynote-server")일 수도, 절대경로(예:
// "C:\Users\...\platform-data-api")일 수도 있다. 워크트리 하위 폴더명은 그냥 그룹핑용이라
// 절대경로를 통째로 하위 경로로 이어붙이면 안 된다 - 윈도우에서는 드라이브 문자(C:)가
// 경로 중간에 끼어서 mkdir이 통째로 실패한다(ENOENT, 실제로 겪은 버그). basename만 써서
// 항상 안전한 폴더 이름 하나로 정규화한다.
function worktreeGroupName(project: string): string {
  return basename(project) || project;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// 메인 브랜치를 직접 건드리지 않도록, 티켓마다 새 브랜치 + 격리된 워크트리를 만든다.
// blocked였던 티켓이 재개되면 같은 ticketId로 다시 호출되는데, 그때는 이미 만들어둔
// 워크트리/브랜치를 그대로 재사용한다 (git worktree add는 같은 브랜치명에 두 번 실행되면 실패한다).
export async function createWorktree(projectPath: string, project: string, ticketId: string): Promise<Worktree> {
  const branch = ticketBranchName(ticketId);
  const groupName = worktreeGroupName(project);
  const worktreePath = join(WORKTREES_ROOT, groupName, ticketId);
  if (await exists(worktreePath)) {
    return { branch, worktreePath };
  }
  await mkdir(join(WORKTREES_ROOT, groupName), { recursive: true });
  const { stdout: baseSha } = await execFileAsync("git", ["-C", projectPath, "rev-parse", "HEAD"]);
  await execFileAsync("git", ["-C", projectPath, "worktree", "add", "-b", branch, worktreePath]);
  await writeFile(baseShaFile(worktreePath), baseSha.trim()).catch(() => {});
  return { branch, worktreePath };
}

// 승인 전에 사람이 "정말 반영할 코드가 있는지" 확인할 수 있게, 이 티켓 브랜치가 base(워크트리를
// 만든 시점의 HEAD) 대비 실제로 커밋을 남겼는지 요약한다. "승인눌렀는데 코드가 없어"(직원이
// 조사만 하고 커밋 없이 끝난 경우 review로 넘어가면서 사람이 모르고 머지 승인)를 막기 위함이다.
export async function summarizeDiff(worktreePath: string): Promise<string> {
  const baseSha = await readBaseSha(worktreePath);
  if (!baseSha) return "(base 커밋을 찾을 수 없어 변경사항을 확인할 수 없습니다)";
  const { stdout: countOut } = await execFileAsync("git", [
    "-C",
    worktreePath,
    "rev-list",
    "--count",
    `${baseSha}..HEAD`,
  ]);
  const commitCount = Number(countOut.trim()) || 0;
  if (commitCount === 0) {
    return "커밋 없음 - 이 티켓은 아직 실제로 반영된 변경사항이 없습니다. 승인해도 코드가 반영되지 않습니다.";
  }
  const { stdout: statOut } = await execFileAsync("git", [
    "-C",
    worktreePath,
    "diff",
    "--shortstat",
    `${baseSha}..HEAD`,
  ]);
  const stat = statOut.trim() || "(변경 통계 없음)";
  return `커밋 ${commitCount}개, ${stat}`;
}

export async function removeWorktree(projectPath: string, worktreePath: string): Promise<void> {
  await execFileAsync("git", ["-C", projectPath, "worktree", "remove", worktreePath, "--force"]);
}

// 워크트리 브랜치를 메인 체크아웃이 지금 보고 있는 브랜치로 머지한다 (브랜치명이 "main"이라고
// 가정하지 않는다 - 워크트리는 그 시점의 HEAD에서 갈라져 나온 것이므로 같은 브랜치로 되돌아간다).
export async function mergeBranch(projectPath: string, branch: string, message: string): Promise<void> {
  await execFileAsync("git", ["-C", projectPath, "merge", "--no-ff", branch, "-m", message]);
}

export async function deleteBranch(projectPath: string, branch: string): Promise<void> {
  await execFileAsync("git", ["-C", projectPath, "branch", "-d", branch]);
}
