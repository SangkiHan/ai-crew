import { execFile } from "node:child_process";
import { mkdir, access } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { ticketBranchName } from "@ai-crew/shared";

const execFileAsync = promisify(execFile);

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
  await execFileAsync("git", ["-C", projectPath, "worktree", "add", "-b", branch, worktreePath]);
  return { branch, worktreePath };
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
