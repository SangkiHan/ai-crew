import { access, cp, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { WORKSPACE_ROOT } from "../workspace.js";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", ".."); // projects -> src -> runner -> repo root
const TEMPLATES_ROOT = join(REPO_ROOT, "templates");

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function hasAnyCommit(repoPath: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["-C", repoPath, "rev-parse", "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

// ai-crew가 만드는 커밋(초기화, 템플릿 추가)은 사용자 git 계정 설정을 건드리지 않고
// -c로 이번 커밋에만 적용되는 임시 신원을 준다.
const GIT_IDENTITY = ["-c", "user.email=ai-crew@local", "-c", "user.name=ai-crew"];

export interface CreateProjectResult {
  success: boolean;
  path?: string;
  error?: string;
}

// 새 프로젝트를 WORKSPACE_ROOT 아래에 만든다. git 저장소 주소가 있으면 클론하고, 없으면
// 새로 초기화한다(git init). 완전히 빈 저장소(커밋이 하나도 없음)는 HEAD가 아직 커밋을
// 가리키지 않아서(unborn branch) 나중에 티켓 작업 시작 시 `git rev-parse HEAD`(baseSha
// 계산용)가 실패하므로, 여기서 미리 초기 커밋을 만들어둔다.
// stack이 알려진 값이면 templates/<stack>/의 기본 CLAUDE.md/.claude/skills를 그 프로젝트에
// 복사한다 (이미 파일이 있으면 덮어쓰지 않는다 - 클론해온 저장소가 이미 자기 컨벤션을 갖고
// 있을 수 있으므로 존중한다).
export async function createProject(name: string, gitUrl?: string, stack?: string): Promise<CreateProjectResult> {
  if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) {
    return { success: false, error: "잘못된 프로젝트 이름입니다" };
  }

  const path = join(WORKSPACE_ROOT, name);
  if (await exists(path)) {
    return { success: false, error: `이미 존재하는 경로입니다: ${path}` };
  }

  try {
    if (gitUrl) {
      await execFileAsync("git", ["clone", gitUrl, path]);
    } else {
      await mkdir(path, { recursive: true });
      await execFileAsync("git", ["-C", path, "init"]);
    }

    if (!(await hasAnyCommit(path))) {
      await writeFile(join(path, "README.md"), `# ${name}\n`);
      await execFileAsync("git", ["-C", path, "add", "README.md"]);
      await execFileAsync("git", ["-C", path, ...GIT_IDENTITY, "commit", "-m", "chore: 프로젝트 초기화 (ai-crew)"]);
    }

    if (stack) {
      await applyTemplate(path, stack);
    }

    return { success: true, path };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function applyTemplate(projectPath: string, stack: string): Promise<void> {
  const templatePath = join(TEMPLATES_ROOT, stack);
  if (!(await exists(templatePath))) return; // 모르는 스택이면 조용히 스킵 (팀장 프롬프트가 알려진 값만 쓰도록 안내함)

  let changed = false;

  const claudeMdSrc = join(templatePath, "CLAUDE.md");
  const claudeMdDest = join(projectPath, "CLAUDE.md");
  if ((await exists(claudeMdSrc)) && !(await exists(claudeMdDest))) {
    await cp(claudeMdSrc, claudeMdDest);
    changed = true;
  }

  const skillsSrc = join(templatePath, "skills");
  const skillsDest = join(projectPath, ".claude", "skills");
  if ((await exists(skillsSrc)) && !(await exists(skillsDest))) {
    await mkdir(join(projectPath, ".claude"), { recursive: true });
    await cp(skillsSrc, skillsDest, { recursive: true });
    changed = true;
  }

  if (changed) {
    await execFileAsync("git", ["-C", projectPath, "add", "CLAUDE.md", ".claude"]);
    await execFileAsync("git", [
      "-C",
      projectPath,
      ...GIT_IDENTITY,
      "commit",
      "-m",
      `chore: ${stack} 기본 skills 추가 (ai-crew)`,
    ]);
  }
}
