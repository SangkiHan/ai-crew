import spawn from "cross-spawn";
import { homedir } from "node:os";
import { join } from "node:path";

// 팀장의 인프라(도메인/DNS/SSL/배포 화면) 직접 조작 기능 - 기본은 꺼져있다(docs/INFRA_MANAGER_PLAN.md).
// 켜면 모든 팀의 팀장에게 적용된다 - 팀별 on/off는 지원하지 않는다.
export const INFRA_BROWSER_ENABLED = process.env.INFRA_BROWSER_ENABLED === "true";
// 팀장은 새 브라우저를 headless로 띄우는 대신, 사용자가 미리 이 포트로 띄워둔 실제 크롬에
// CDP(Chrome DevTools Protocol)로 붙는다 - 사용자가 로그인하고 원하는 화면까지 이동해둔 바로
// 그 탭을 이어서 조작하기 위해서다(README "인프라 자동화" 참고).
export const INFRA_BROWSER_CDP_ENDPOINT = process.env.INFRA_BROWSER_CDP_ENDPOINT ?? "http://localhost:9222";
// 평소 쓰는 메인 크롬 프로필과 분리된 인프라 자동화 전용 프로필. 웹 UI의 "인프라 크롬" 버튼이
// 이 프로필로 크롬을 띄워주므로, 사용자는 그 안에서 필요한 사이트에 한 번만 로그인해두면 된다.
const INFRA_BROWSER_PROFILE_DIR =
  process.env.INFRA_BROWSER_PROFILE_DIR ?? join(homedir(), ".ai-crew", "infra-browser-profile");
// @playwright/mcp는 기본으로 스냅샷(.yml)/콘솔 로그(.log)를 현재 작업 디렉터리(=ai-crew 저장소
// 루트, MANAGER_CWD)의 .playwright-mcp/에 쌓는다 - 그대로 두면 저장소 안에 세션마다 파일이
// 계속 늘어난다. 저장소 밖 상태 디렉터리로 --output-dir을 지정해 애초에 안 쌓이게 한다.
export const INFRA_BROWSER_OUTPUT_DIR =
  process.env.INFRA_BROWSER_OUTPUT_DIR ?? join(homedir(), ".ai-crew", "infra-browser-output");

function chromeCandidates(): string[] {
  switch (process.platform) {
    case "win32":
      return [
        join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
        join(
          process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)",
          "Google",
          "Chrome",
          "Application",
          "chrome.exe"
        ),
        join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
      ];
    case "darwin":
      return ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
    default:
      return ["google-chrome", "chromium-browser", "chromium"];
  }
}

function portFromEndpoint(endpoint: string): string {
  try {
    return new URL(endpoint).port || "9222";
  } catch {
    return "9222";
  }
}

// 웹 UI의 "인프라 크롬" 버튼이 부른다. 후보 경로를 순서대로 시도하다 처음 성공하는 것에서
// 멈춘다. 이미 같은 디버깅 포트/프로필로 크롬이 떠 있어도 안전하다 - 크롬 자체가 새 창만
// 열고 기존 프로세스에 합류한다. detached + unref로 러너가 나중에 죽어도 이 크롬은 그대로 남는다.
export async function launchInfraBrowser(): Promise<{ success: boolean; error?: string }> {
  const port = portFromEndpoint(INFRA_BROWSER_CDP_ENDPOINT);
  const args = [`--remote-debugging-port=${port}`, `--user-data-dir=${INFRA_BROWSER_PROFILE_DIR}`];

  for (const bin of chromeCandidates()) {
    const spawned = await new Promise<boolean>((resolve) => {
      const child = spawn(bin, args, { detached: true, stdio: "ignore" });
      child.once("error", () => resolve(false));
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
    });
    if (spawned) return { success: true };
  }
  return { success: false, error: "크롬 실행파일을 찾지 못했습니다. Google Chrome이 설치돼 있는지 확인해주세요." };
}
