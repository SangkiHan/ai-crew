import { execFile } from "node:child_process";
import { mkdir, access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ticketBranchName } from "@ai-crew/shared";

const execFileAsync = promisify(execFile);

const WORKTREES_ROOT = process.env.WORKTREES_ROOT ?? join(homedir(), ".ai-crew", "worktrees");

export interface Worktree {
  branch: string;
  worktreePath: string;
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
  const worktreePath = join(WORKTREES_ROOT, project, ticketId);
  if (await exists(worktreePath)) {
    return { branch, worktreePath };
  }
  await mkdir(join(WORKTREES_ROOT, project), { recursive: true });
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
