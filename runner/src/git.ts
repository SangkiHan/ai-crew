import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// 사용자 결정: 직원은 격리된 워크트리/새 브랜치가 아니라 프로젝트 실제 폴더에서 현재
// 체크아웃된 브랜치에 직접 작업하고 직접 커밋한다. 그래서 이 모듈은 "브랜치/워크트리를
// 만드는" 게 아니라 "지금 상태를 읽어서 참고/진단용으로만 쓰는" 역할만 한다 - 격리가
// 없어졌으니 같은 프로젝트에 티켓 2개가 동시에 돌면 서로 파일을 건드릴 수 있다는 걸
// 사용자가 인지하고 선택했다.

export async function currentBranch(projectPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", projectPath, "rev-parse", "--abbrev-ref", "HEAD"]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function currentHeadSha(projectPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", projectPath, "rev-parse", "HEAD"]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

// 승인 전에 사람이 "정말 반영할 코드가 있는지" 확인할 수 있게, 작업 시작 시점(baseSha) 대비
// 실제로 커밋이 생겼는지 요약한다. "승인눌렀는데 코드가 없어"(직원이 조사만 하고 커밋 없이
// 끝난 경우 그대로 완료 처리되는 사고)를 막기 위함이다.
export async function summarizeDiff(projectPath: string, baseSha: string | null): Promise<string> {
  if (!baseSha) return "(작업 시작 시점을 확인할 수 없어 변경사항을 확인할 수 없습니다)";
  try {
    const { stdout: countOut } = await execFileAsync("git", [
      "-C",
      projectPath,
      "rev-list",
      "--count",
      `${baseSha}..HEAD`,
    ]);
    const commitCount = Number(countOut.trim()) || 0;
    if (commitCount === 0) {
      return "커밋 없음 - 이 티켓은 아직 실제로 반영된 변경사항이 없습니다.";
    }
    const { stdout: statOut } = await execFileAsync("git", [
      "-C",
      projectPath,
      "diff",
      "--shortstat",
      `${baseSha}..HEAD`,
    ]);
    const stat = statOut.trim() || "(변경 통계 없음)";
    return `커밋 ${commitCount}개, ${stat}`;
  } catch (err) {
    return `(변경사항 확인 실패: ${err instanceof Error ? err.message : String(err)})`;
  }
}
