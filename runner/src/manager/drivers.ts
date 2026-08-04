import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import spawn from "cross-spawn";
import { runClaudeHeadless } from "../claude/headless.js";
import { summarizeCodexEvent } from "../drivers/codex.js";
import { readSessionId, writeSessionId } from "./session.js";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", ".."); // manager -> src -> runner -> repo root
const MCP_SERVER_ENTRY = process.env.MCP_SERVER_ENTRY ?? join(REPO_ROOT, "apps", "server", "dist", "mcp", "server.js");
const AI_CREW_SERVER_URL = process.env.AI_CREW_SERVER_URL ?? "http://localhost:8080";
// MCP 서버 자식 프로세스(apps/server/dist/mcp/server.js)의 list_projects가 이 env로 스캔
// 대상을 정한다 - claude 경로(invoke.ts의 buildMcpConfig)와 동일하게 넘겨야 한다.
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT ?? join(homedir(), "Desktop", "Project");
const MANAGER_CWD = process.env.MANAGER_CWD ?? REPO_ROOT;
const MCP_SERVER_NAME = "ai-crew-manager-tools";

export interface ManagerResult {
  sessionId: string;
  resultText: string;
  success: boolean;
}

// claude만 --resume으로 대화를 이어간다(manager/session.ts). antigravity/codex는 이 코드베이스
// 전체에서 세션 재개가 구현돼 있지 않다(직원용 antigravity/codex 드라이버도 동일한 한계 -
// codex는 sessionId를 CLI에 넘기지도 않는 placeholder일 뿐이다). 그래서 이 두 드라이버로
// 팀장을 돌리면 매 호출이 새 대화로 시작된다 - 팀장이 직전에 뭘 위임했는지 기억하지 못한다.
// 웹 UI(TeamProjectsManager)가 이 사실을 안내 문구로 미리 보여준다.

export async function runManagerClaude(
  teamId: string,
  message: string,
  systemPrompt: string,
  allowedTools: string[],
  model: string | undefined,
  mcpConfigJson: string,
  onEvent?: (line: string) => void
): Promise<ManagerResult> {
  const previousSessionId = await readSessionId(teamId);
  const result = await runClaudeHeadless({
    message,
    systemPrompt,
    allowedTools,
    permissionMode: "dontAsk",
    cwd: MANAGER_CWD,
    model,
    resumeSessionId: previousSessionId ?? undefined,
    mcpConfigJson,
    onEvent,
  });
  if (result.sessionId) await writeSessionId(teamId, result.sessionId);
  return result;
}

// Antigravity CLI(agy)의 워크스페이스 컨텍스트 파일을 팀장 실행 디렉토리(REPO_ROOT, ai-crew
// 저장소 자체)에 쓴다. 직원 드라이버(runner/src/drivers/antigravity.ts)와 같은 방식 -
// GEMINI.md/.agents/는 git의 로컬 전용 exclude에 등록해 절대 커밋되지 않게 한다.
async function writeAntigravityContext(teamId: string, systemPrompt: string): Promise<void> {
  const agentsDir = join(MANAGER_CWD, ".agents");
  await mkdir(agentsDir, { recursive: true });
  const settings = {
    mcpServers: {
      [MCP_SERVER_NAME]: {
        command: "node",
        args: [MCP_SERVER_ENTRY],
        env: { AI_CREW_SERVER_URL, WORKSPACE_ROOT, TEAM_ID: teamId },
      },
    },
  };
  await writeFile(join(agentsDir, "mcp_config.json"), JSON.stringify(settings, null, 2), "utf-8");
  await writeFile(join(MANAGER_CWD, "GEMINI.md"), systemPrompt, "utf-8");
  try {
    const { stdout } = await execFileAsync("git", ["-C", MANAGER_CWD, "rev-parse", "--git-path", "info/exclude"]);
    await appendFile(join(MANAGER_CWD, stdout.trim()), "\nGEMINI.md\n.agents/\n");
  } catch {
    // exclude 등록 실패해도 팀장 호출 자체는 계속한다 - 최선노력.
  }
}

export async function runManagerAntigravity(
  teamId: string,
  message: string,
  systemPrompt: string,
  model: string | undefined,
  onEvent?: (line: string) => void
): Promise<ManagerResult> {
  await writeAntigravityContext(teamId, systemPrompt);

  const args = [
    "-p",
    message,
    "--dangerously-skip-permissions",
    // 팀장은 위임만 하는 가벼운 호출이라 직원(120m)보다 짧게 잡는다.
    "--print-timeout",
    "30m",
    ...(model ? ["--model", model] : []),
  ];

  let stdoutTail = "";
  const success = await new Promise<boolean>((resolve) => {
    const child = spawn("agy", args, { cwd: MANAGER_CWD });
    let buffer = "";
    let stderr = "";

    child.stdout!.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdoutTail = (stdoutTail + text).slice(-4000);
      buffer += text;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        onEvent?.(`[manager:agy] ${line}`);
      }
    });

    child.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      onEvent?.(`[manager:agy] 실행 실패: ${err.message}`);
      resolve(false);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        onEvent?.(`[manager:agy] 비정상 종료 (code ${code}): ${stderr || "(stderr 없음)"}`);
      }
      resolve(code === 0);
    });
  });

  // antigravity는 대화 이어가기를 지원하지 않으므로 저장할 세션 id가 없다 - 항상 빈 문자열.
  return { sessionId: "", resultText: stdoutTail.trim(), success };
}

export async function runManagerCodex(
  teamId: string,
  message: string,
  systemPrompt: string,
  model: string | undefined,
  onEvent?: (line: string) => void
): Promise<ManagerResult> {
  const prefix = `mcp_servers.${MCP_SERVER_NAME}`;
  const safeEntry = MCP_SERVER_ENTRY.replace(/\\/g, "/");
  const args = [
    "exec",
    `${systemPrompt}\n\n${message}`,
    "--json",
    "-C",
    MANAGER_CWD,
    // 팀장은 코드를 직접 수정하지 않는 역할이라(agents/manager.md) claude의 allowedTools=[Read,
    // Grep,Glob] 제약과 가장 가까운 read-only 샌드박스를 쓴다 - 직원 codex(workspace-write)보다
    // 엄격하다. MCP 툴 호출(create_ticket 등)은 서버에 대한 HTTP 요청이라 로컬 파일쓰기 제한과
    // 무관하게 그대로 동작한다.
    "-s",
    "read-only",
    "--skip-git-repo-check",
    "--ephemeral",
    ...(model ? ["-m", model] : []),
    "-c",
    `${prefix}.command="node"`,
    "-c",
    `${prefix}.args=["${safeEntry}"]`,
    "-c",
    `${prefix}.env.AI_CREW_SERVER_URL="${AI_CREW_SERVER_URL}"`,
    "-c",
    `${prefix}.env.WORKSPACE_ROOT="${WORKSPACE_ROOT.replace(/\\/g, "/")}"`,
    "-c",
    `${prefix}.env.TEAM_ID="${teamId}"`,
  ];

  let failureText = "";
  // 팀장의 최종 응답은 채팅으로 사용자에게 그대로 보이는 텍스트라 로그 요약과 별도로 모아야
  // 한다 - agent_message 이벤트가 여러 번 올 수 있어 마지막 것(가장 완성된 응답)을 쓴다.
  let lastAgentMessage = "";
  const success = await new Promise<boolean>((resolve) => {
    const child = spawn("codex", args, { cwd: MANAGER_CWD, stdio: ["ignore", "pipe", "pipe"] });

    let buffer = "";
    let stderr = "";
    let settled = false;
    // codex는 직원 드라이버와 마찬가지로 진행 이벤트가 전혀 없으면 어딘가 멈춘 것 - 60초 안에
    // 첫 이벤트가 없으면 중단한다(headless 세션이 승인 대기 등으로 영영 멈추는 걸 방지).
    const startupTimeout = setTimeout(() => {
      if (settled) return;
      onEvent?.("[manager:codex] 60초 동안 시작 이벤트가 없어 실행을 중단했습니다");
      child.kill();
    }, 60_000);

    const emit = (line: string) => {
      const text = line.trim();
      if (text) onEvent?.(text);
    };

    child.stdout!.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const event = JSON.parse(line) as any;
          if (event.type === "item.completed" && event.item?.type === "agent_message") {
            const text = event.item.text ?? event.item.content;
            if (text) lastAgentMessage = text;
          }
          const summary = summarizeCodexEvent(event);
          emit(summary ? `[manager:codex] ${summary}` : `[manager:codex] ${event.type ?? "이벤트"}`);
        } catch {
          emit(`[manager:codex] ${line}`);
        }
      }
    });

    child.stderr!.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      failureText = stderr;
      for (const line of text.split(/\r?\n/)) emit(`[manager:codex] stderr: ${line}`);
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(startupTimeout);
      emit(`[manager:codex] 실행 실패: ${err.message}`);
      resolve(false);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(startupTimeout);
      if (code !== 0) {
        emit(`[manager:codex] 비정상 종료 (code ${code}): ${stderr.trim() || "(stderr 없음)"}`);
      }
      resolve(code === 0);
    });
  });

  // codex도 대화 이어가기를 지원하지 않는다 - 매번 새 세션.
  return { sessionId: "", resultText: success ? lastAgentMessage.trim() : failureText.trim(), success };
}
