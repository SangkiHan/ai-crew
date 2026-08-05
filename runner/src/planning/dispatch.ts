import { appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import spawn from "cross-spawn";
import type { Employee, RunnerToServerEvent } from "@ai-crew/shared";
import { envWithAgyPath } from "../antigravity-path.js";
import { runClaudeHeadless } from "../claude/headless.js";
import { summarizeCodexEvent } from "../drivers/codex.js";
import { buildPlanningPrompt } from "../employees/prompt.js";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", ".."); // planning -> src -> runner -> repo root
const PLANNING_MCP_SERVER_ENTRY =
  process.env.PLANNING_MCP_SERVER_ENTRY ?? join(REPO_ROOT, "apps", "server", "dist", "mcp", "planning-server.js");
const AI_CREW_SERVER_URL = process.env.AI_CREW_SERVER_URL ?? "http://localhost:8080";
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT ?? join(homedir(), "Desktop", "Project");

const PLANNING_MCP_SERVER_NAME = "ai-crew-planning-tools";
const PLANNING_TOOL_NAMES = ["list_projects", "list_employees", "ask_employee"].map(
  (tool) => `mcp__${PLANNING_MCP_SERVER_NAME}__${tool}`
);

function buildPlanningMcpConfig(teamId: string): string {
  return JSON.stringify({
    mcpServers: {
      [PLANNING_MCP_SERVER_NAME]: {
        type: "stdio",
        command: "node",
        args: [PLANNING_MCP_SERVER_ENTRY],
        env: { AI_CREW_SERVER_URL, WORKSPACE_ROOT, TEAM_ID: teamId },
      },
    },
  });
}

// claude만 --resume으로 세션을 이어간다. antigravity/codex는 이 코드베이스 전체에서 세션
// 재개가 구현돼 있지 않다(팀장/직원 antigravity·codex 드라이버와 같은 한계). 그래서 세션을
// 이어갈 수 없는 모든 경로(비-claude 드라이버, 또는 claude인데 세션을 잃어버린 경우)에서는
// "이전 기획서 + 수정 요청"을 한 메시지로 묶어 매번 처음부터 완전한 맥락을 실어 보낸다 -
// 안 그러면 세션 기억이 없는 상태에서 "이 부분 고쳐줘"만 받아 전혀 다른 기획서가 나온다.
function buildStandaloneMessage(originalRequest: string, previousContent: string | null, message: string): string {
  if (previousContent === null) {
    return (
      `다음 요청에 대해 상세한 서비스 기획서를 마크다운으로 작성하세요.\n\n` +
      `## 요청\n${originalRequest}\n\n` +
      `기획서에는 목적/배경, 주요 기능, 사용자 흐름, 필요한 화면/API, 우선순위(MVP 범위)를 포함하세요.`
    );
  }
  return (
    `아래는 이전에 다음 요청으로 작성한 기획서 초안입니다. 사용자의 수정 요청을 반영해\n` +
    `기획서 전체를 마크다운으로 다시 작성하세요(일부만 답하지 말고 전체 문서를 다시 내놓으세요).\n\n` +
    `## 원래 요청\n${originalRequest}\n\n` +
    `## 이전 초안\n${previousContent}\n\n` +
    `## 수정 요청\n${message}`
  );
}

export interface PlanningResult {
  success: boolean;
  content: string;
  sessionId?: string;
}

// 기획서 작성은 git worktree가 필요 없다 (코드를 안 건드리므로) - WORKSPACE_ROOT를 cwd로 두고
// 필요하면 Read/Grep/Glob으로 기존 프로젝트를 참고만 하게 한다. 결과 텍스트 자체가 기획서다.
// 실행 CLI(driver)는 직원 설정을 그대로 따른다 - claude만 대화 이어가기(--resume)를 지원하고,
// 다른 드라이버는 매 호출이 새 세션이라 buildStandaloneMessage로 맥락을 매번 다시 실어 보낸다.
export async function runPlanningDoc(
  planningDocId: string,
  employee: Employee,
  message: string,
  originalRequest: string,
  previousContent: string | null,
  send: (event: RunnerToServerEvent) => void,
  resumeSessionId?: string
): Promise<void> {
  const now = () => new Date().toISOString();
  const onEvent = (line: string) => send({ type: "planning_doc_log", planningDocId, line, ts: now() });

  let result: PlanningResult;
  try {
    switch (employee.driver) {
      case "antigravity":
        result = await runPlanningAntigravity(employee, message, originalRequest, previousContent, onEvent);
        break;
      case "codex":
        result = await runPlanningCodex(employee, message, originalRequest, previousContent, onEvent);
        break;
      case "claude":
      default:
        result = await runPlanningClaude(
          employee,
          message,
          originalRequest,
          previousContent,
          onEvent,
          resumeSessionId
        );
        break;
    }
  } catch (err) {
    send({
      type: "planning_doc_result",
      planningDocId,
      success: false,
      content: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  send({
    type: "planning_doc_result",
    planningDocId,
    success: result.success,
    content: result.content || (result.success ? "" : "(기획서 생성 실패 - 세션 로그를 확인하세요)"),
    sessionId: result.sessionId,
  });
}

async function runPlanningClaude(
  employee: Employee,
  message: string,
  originalRequest: string,
  previousContent: string | null,
  onEvent: (line: string) => void,
  resumeSessionId?: string
): Promise<PlanningResult> {
  // 세션을 이어갈 수 있으면(직전 초안과 같은 대화) 사용자의 수정 요청만 그대로 보낸다 - 세션이
  // 이미 원래 요청과 이전 초안을 기억하고 있으므로 다시 실어 보낼 필요가 없다. 이어갈 세션이
  // 없으면(최초 요청, 또는 세션 유실) 맥락을 전부 담은 메시지로 새로 시작한다.
  const fullMessage = resumeSessionId ? message : buildStandaloneMessage(originalRequest, previousContent, message);

  const result = await runClaudeHeadless({
    message: fullMessage,
    systemPrompt: buildPlanningPrompt(employee.taskDescription),
    allowedTools: ["Read", "Grep", "Glob", ...PLANNING_TOOL_NAMES],
    permissionMode: "acceptEdits",
    cwd: WORKSPACE_ROOT,
    model: employee.model,
    resumeSessionId,
    mcpConfigJson: buildPlanningMcpConfig(employee.teamId),
    onEvent,
  });

  return { success: result.success, content: result.resultText, sessionId: result.sessionId };
}

// Antigravity CLI(agy)의 워크스페이스 컨텍스트 파일을 WORKSPACE_ROOT에 잠깐 쓴다. 주의:
// WORKSPACE_ROOT는 팀장(ai-crew 저장소 자체)이나 티켓(대상 프로젝트)의 cwd와 달리 그 자체가
// git 저장소가 아니다 - 여러 프로젝트 폴더를 담은 상위 폴더일 뿐이다. 그래서 직원/팀장
// 드라이버가 쓰는 "git의 로컬 전용 exclude에 등록" 방식이 여기선 통하지 않는다(조용히
// 실패할 뿐이라 무해하지만 실효가 없다). 대신 실행이 끝나면 반드시 파일을 지운다(finally) -
// WORKSPACE_ROOT에 GEMINI.md/.agents/가 영구히 남아 사용자 프로젝트 폴더 목록을 어지럽히면 안 된다.
async function withAntigravityPlanningContext<T>(
  teamId: string,
  systemPrompt: string,
  fn: () => Promise<T>
): Promise<T> {
  const agentsDir = join(WORKSPACE_ROOT, ".agents");
  const geminiMdPath = join(WORKSPACE_ROOT, "GEMINI.md");
  await mkdir(agentsDir, { recursive: true });
  const settings = {
    mcpServers: {
      [PLANNING_MCP_SERVER_NAME]: {
        command: "node",
        args: [PLANNING_MCP_SERVER_ENTRY],
        env: { AI_CREW_SERVER_URL, WORKSPACE_ROOT, TEAM_ID: teamId },
      },
    },
  };
  await writeFile(join(agentsDir, "mcp_config.json"), JSON.stringify(settings, null, 2), "utf-8");
  await writeFile(geminiMdPath, systemPrompt, "utf-8");
  // WORKSPACE_ROOT가 우연히 git 저장소인 드문 경우를 위해 시도는 해두되, 실패해도 무시한다 -
  // 아래 finally가 파일 삭제로 정리를 보장하므로 exclude 등록 성공 여부와 무관하게 안전하다.
  try {
    const { stdout } = await execFileAsync("git", ["-C", WORKSPACE_ROOT, "rev-parse", "--git-path", "info/exclude"]);
    await appendFile(join(WORKSPACE_ROOT, stdout.trim()), "\nGEMINI.md\n.agents/\n");
  } catch {
    // WORKSPACE_ROOT가 git 저장소가 아닌 게 정상 케이스다.
  }

  try {
    return await fn();
  } finally {
    await rm(geminiMdPath, { force: true }).catch(() => {});
    await rm(agentsDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function runPlanningAntigravity(
  employee: Employee,
  message: string,
  originalRequest: string,
  previousContent: string | null,
  onEvent: (line: string) => void
): Promise<PlanningResult> {
  const fullMessage = buildStandaloneMessage(originalRequest, previousContent, message);
  const systemPrompt = buildPlanningPrompt(employee.taskDescription);

  return withAntigravityPlanningContext(employee.teamId, systemPrompt, async () => {
    const args = [
      "-p",
      fullMessage,
      "--dangerously-skip-permissions",
      "--print-timeout",
      "20m",
      ...(employee.model ? ["--model", employee.model] : []),
    ];

    let stdoutTail = "";
    const success = await new Promise<boolean>((resolve) => {
      const child = spawn("agy", args, { cwd: WORKSPACE_ROOT, env: envWithAgyPath() });
      let buffer = "";
      let stderr = "";

      child.stdout!.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stdoutTail = (stdoutTail + text).slice(-20_000); // 기획서 본문이라 응답 하나가 길 수 있다.
        buffer += text;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim()) onEvent(`[planning:agy] ${line}`);
        }
      });
      child.stderr!.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on("error", (err) => {
        onEvent(`[planning:agy] 실행 실패: ${err.message}`);
        resolve(false);
      });
      child.on("close", (code) => {
        if (code !== 0) onEvent(`[planning:agy] 비정상 종료 (code ${code}): ${stderr || "(stderr 없음)"}`);
        resolve(code === 0);
      });
    });

    // 대화 이어가기를 지원하지 않으므로 저장할 세션 id가 없다.
    return { success, content: stdoutTail.trim() };
  });
}

async function runPlanningCodex(
  employee: Employee,
  message: string,
  originalRequest: string,
  previousContent: string | null,
  onEvent: (line: string) => void
): Promise<PlanningResult> {
  const fullMessage = buildStandaloneMessage(originalRequest, previousContent, message);
  const systemPrompt = buildPlanningPrompt(employee.taskDescription);
  const prefix = `mcp_servers.${PLANNING_MCP_SERVER_NAME}`;
  const safeEntry = PLANNING_MCP_SERVER_ENTRY.replace(/\\/g, "/");
  const args = [
    "exec",
    `${systemPrompt}\n\n${fullMessage}`,
    "--json",
    "-C",
    WORKSPACE_ROOT,
    // 기획자는 코드를 수정하지 않는 조사·작성 전용 역할이라(claude 경로도 Read/Grep/Glob만
    // 허용하는 것과 같은 이유) read-only 샌드박스를 쓴다. MCP 툴 호출은 서버에 대한 HTTP
    // 요청이라 로컬 파일쓰기 제한과 무관하게 그대로 동작한다.
    "-s",
    "read-only",
    "--skip-git-repo-check",
    "--ephemeral",
    ...(employee.model ? ["-m", employee.model] : []),
    "-c",
    `${prefix}.command="node"`,
    "-c",
    `${prefix}.args=["${safeEntry}"]`,
    "-c",
    `${prefix}.env.AI_CREW_SERVER_URL="${AI_CREW_SERVER_URL}"`,
    "-c",
    `${prefix}.env.WORKSPACE_ROOT="${WORKSPACE_ROOT.replace(/\\/g, "/")}"`,
    "-c",
    `${prefix}.env.TEAM_ID="${employee.teamId}"`,
  ];

  let failureText = "";
  // 기획자의 최종 응답(기획서 본문)은 로그 요약과 별도로 모아야 한다 - agent_message가 여러
  // 번 올 수 있어 마지막 것(가장 완성된 응답)을 쓴다.
  let lastAgentMessage = "";
  const success = await new Promise<boolean>((resolve) => {
    const child = spawn("codex", args, { cwd: WORKSPACE_ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let buffer = "";
    let stderr = "";
    let settled = false;
    const startupTimeout = setTimeout(() => {
      if (settled) return;
      onEvent("[planning:codex] 60초 동안 시작 이벤트가 없어 실행을 중단했습니다");
      child.kill();
    }, 60_000);

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
          onEvent(summary ? `[planning:codex] ${summary}` : `[planning:codex] ${event.type ?? "이벤트"}`);
        } catch {
          onEvent(`[planning:codex] ${line}`);
        }
      }
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      failureText = stderr;
      for (const line of text.split(/\r?\n/)) if (line.trim()) onEvent(`[planning:codex] stderr: ${line}`);
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(startupTimeout);
      onEvent(`[planning:codex] 실행 실패: ${err.message}`);
      resolve(false);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(startupTimeout);
      if (code !== 0) onEvent(`[planning:codex] 비정상 종료 (code ${code}): ${stderr.trim() || "(stderr 없음)"}`);
      resolve(code === 0);
    });
  });

  return { success, content: success ? lastAgentMessage.trim() : failureText.trim() };
}
