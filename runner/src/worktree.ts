import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const WORKTREES_ROOT = process.env.WORKTREES_ROOT ?? join(process.env.HOME ?? "", ".ai-crew", "worktrees");

export interface Worktree {
  branch: string;
  worktreePath: string;
}

// 메인 브랜치를 직접 건드리지 않도록, 티켓마다 새 브랜치 + 격리된 워크트리를 만든다.
export async function createWorktree(projectPath: string, project: string, ticketId: string): Promise<Worktree> {
  const branch = `ai-crew/${ticketId}`;
  const worktreePath = join(WORKTREES_ROOT, project, ticketId);
  await mkdir(join(WORKTREES_ROOT, project), { recursive: true });
  await execFileAsync("git", ["-C", projectPath, "worktree", "add", "-b", branch, worktreePath]);
  return { branch, worktreePath };
}

export async function removeWorktree(projectPath: string, worktreePath: string): Promise<void> {
  await execFileAsync("git", ["-C", projectPath, "worktree", "remove", worktreePath, "--force"]);
}
