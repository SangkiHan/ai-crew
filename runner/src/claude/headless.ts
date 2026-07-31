import spawn from "cross-spawn";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface HeadlessRunOptions {
  message: string;
  systemPrompt: string;
  allowedTools: string[];
  disallowedTools?: string[];
  permissionMode: "default" | "acceptEdits" | "dontAsk" | "bypassPermissions";
  cwd: string;
  model?: string;
  resumeSessionId?: string;
  mcpConfigJson?: string;
  onEvent?: (line: string) => void;
  // 워크트리에 pid를 기록해두면(claude/gemini/codex 드라이버가 씀), 러너 재시작 후 이 티켓을
  // 다시 집어들 때 이전 세션이 아직 살아있는지 확인하고 정리할 수 있다.
  onSpawn?: (pid: number | undefined) => void;
}

export interface HeadlessRunResult {
  sessionId: string;
  resultText: string;
  success: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function summarizeEvent(event: any): string | null {
  if (event.type === "system" && event.subtype === "init") {
    return `[claude] 세션 시작 (model: ${event.model ?? "?"})`;
  }
  if (event.type === "assistant" && Array.isArray(event.message?.content)) {
    const lines: string[] = [];
    for (const block of event.message.content) {
      if (block.type === "text" && block.text?.trim()) {
        lines.push(`[claude] ${block.text.trim()}`);
      } else if (block.type === "tool_use") {
        const input = JSON.stringify(block.input ?? {});
        const truncated = input.length > 200 ? `${input.slice(0, 200)}…` : input;
        lines.push(`[claude] tool: ${block.name} ${truncated}`);
      }
    }
    return lines.length ? lines.join("\n") : null;
  }
  if (event.type === "result") {
    return `[claude] 종료 (${event.subtype ?? "result"})`;
  }
  return null;
}

// claude -p의 프롬프트가 "/"로 시작하면, CLI가 이걸 실제 프롬프트가 아니라 슬래시 명령
// 호출로 오인한다 (예: 사용자가 그냥 "/정리해줘"라고 말했을 뿐인데 "Unknown command: ..."만
// 찍고 빈 응답으로 끝나버림 - 실제로 겪은 버그). 첫 글자가 "/"가 안 되도록 안전하게 감싼다.
function escapeSlashCommand(message: string): string {
  if (!message.trimStart().startsWith("/")) return message;
  return `다음은 사용자가 보낸 메시지입니다 (그대로 프롬프트로 취급하세요):\n${message}`;
}

// claude -p 헤드리스 프로세스를 스폰하고 stream-json 출력을 파싱한다.
// 팀장(runner/src/manager)과 실제 직원 드라이버(runner/src/drivers/claude.ts) 양쪽에서 공유한다.
export async function runClaudeHeadless(opts: HeadlessRunOptions): Promise<HeadlessRunResult> {
  // systemPrompt(수 KB의 마크다운)와 mcpConfigJson을 CLI 인자로 그대로 넘기면, 윈도우에서
  // 커맨드라인 인코딩/이스케이핑이 깨져 --output-format 같은 뒤쪽 플래그까지 통째로 무시되는
  // 문제를 실제로 겪었다 (같은 버전인데도 stream-json 대신 일반 텍스트만 나옴). 큰 값은 임시
  // 파일에 써서 경로만 넘기는 --append-system-prompt-file/--mcp-config(파일 지원)로 바꿔
  // 커맨드라인 자체를 짧고 단순하게 유지한다.
  const tempDir = await mkdtemp(join(tmpdir(), "ai-crew-"));
  const systemPromptFile = join(tempDir, "system-prompt.txt");
  await writeFile(systemPromptFile, opts.systemPrompt, "utf-8");

  const args = [
    "-p",
    escapeSlashCommand(opts.message),
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    opts.permissionMode,
    "--allowedTools",
    opts.allowedTools.join(","),
    "--append-system-prompt-file",
    systemPromptFile,
  ];
  if (opts.disallowedTools?.length) {
    args.push("--disallowedTools", opts.disallowedTools.join(","));
  }
  if (opts.model) {
    args.push("--model", opts.model);
  }
  if (opts.mcpConfigJson) {
    const mcpConfigFile = join(tempDir, "mcp-config.json");
    await writeFile(mcpConfigFile, opts.mcpConfigJson, "utf-8");
    args.push("--mcp-config", mcpConfigFile);
  }
  if (opts.resumeSessionId) {
    args.push("--resume", opts.resumeSessionId);
  }

  const cleanupTempDir = () => {
    rm(tempDir, { recursive: true, force: true }).catch(() => {});
  };

  return new Promise((resolve, reject) => {
    // stdin을 열어둔 채(기본값 pipe) 아무것도 안 쓰고 안 닫으면, claude가 몇 초간 stdin을
    // 기다리다 포기하는 동작이 모든 호출에서 매번 관찰됐다("Warning: no stdin data received").
    // 헤드리스 호출은 애초에 stdin으로 줄 게 없으니 처음부터 닫아서 이 대기/타이밍 자체를
    // 없앤다 - claude가 내부적으로 MCP 서버를 자식 프로세스로 또 띄우는데, 윈도우에서 부모
    // 프로세스의 stdio 상태가 애매하면 그 하위 스폰이 불안정해지는 걸로 추정된다.
    const child = spawn("claude", args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });
    opts.onSpawn?.(child.pid);

    let buffer = "";
    let stderr = "";
    let sessionId = opts.resumeSessionId ?? "";
    let resultText = "";
    // --output-format stream-json이 어떤 이유로든 안 지켜지고 claude가 그냥 일반 텍스트를
    // 뱉는 환경(윈도우에서 실제로 관측됨 - 버전은 같은데도 발생)이 있다. 그런 줄은 JSON으로
    // 파싱은 안 되지만 실제로는 진짜 응답 내용이므로, 버리지 않고 모아뒀다가 result 이벤트를
    // 끝내 못 받으면 이걸 대신 응답으로 쓴다 - "성공했는데 빈 응답"보다는 훨씬 낫다.
    const plainTextLines: string[] = [];

    child.stdout!.on("data", (chunk: Buffer) => {
      // 윈도우에서 CRLF로 올 수 있어 \r\n 둘 다 줄바꿈으로 취급한다.
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let event: any;
        try {
          event = JSON.parse(line);
        } catch {
          // stream-json이어야 할 줄이 파싱 안 되면 (부분 라인이 아니라 진짜 문제일 수 있음)
          // 조용히 삼키지 말고 원본을 남긴다 - "성공했는데 아무 로그도 없다" 같은 상황을 진단할 단서.
          opts.onEvent?.(`[claude] (JSON 아님, 원문으로 취급) ${line.slice(0, 300)}`);
          plainTextLines.push(rawLine);
          continue;
        }
        if (typeof event.session_id === "string") sessionId = event.session_id;
        if (event.type === "result" && typeof event.result === "string") {
          resultText = event.result;
        }
        const summary = summarizeEvent(event);
        if (summary) opts.onEvent?.(summary);
      }
    });

    child.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      cleanupTempDir();
      reject(err);
    });

    child.on("close", (code) => {
      cleanupTempDir();
      const success = code === 0;
      if (!success) {
        opts.onEvent?.(`[claude] 비정상 종료 (code ${code}): ${stderr || "(stderr 없음)"}`);
      } else if (!resultText && plainTextLines.length > 0) {
        // stream-json의 result 이벤트는 못 받았지만, JSON이 아닌 일반 텍스트 줄들이 있었다면
        // (예: 이 환경에서 --output-format이 안 지켜짐) 그걸 이어붙여 실제 응답으로 쓴다.
        resultText = plainTextLines.join("\n").trim();
        opts.onEvent?.(`[claude] (stream-json 형식이 아니어서 원문 텍스트를 응답으로 사용했습니다)`);
      } else if (!resultText) {
        // 그것도 없으면 정말 아무 단서가 없는 것 - stderr/남은 버퍼라도 남긴다.
        opts.onEvent?.(
          `[claude] 종료 코드는 0이지만 응답 텍스트를 못 읽었습니다. ` +
            `stderr: ${stderr.trim() || "(없음)"} / 남은 버퍼: ${buffer.slice(0, 300) || "(없음)"}`
        );
      }
      resolve({ sessionId, resultText: resultText || (success ? "" : stderr), success });
    });
  });
}
