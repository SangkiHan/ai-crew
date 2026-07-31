import spawn from "cross-spawn";

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
export function runClaudeHeadless(opts: HeadlessRunOptions): Promise<HeadlessRunResult> {
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
    "--append-system-prompt",
    opts.systemPrompt,
  ];
  if (opts.disallowedTools?.length) {
    args.push("--disallowedTools", opts.disallowedTools.join(","));
  }
  if (opts.model) {
    args.push("--model", opts.model);
  }
  if (opts.mcpConfigJson) {
    args.push("--mcp-config", opts.mcpConfigJson);
  }
  if (opts.resumeSessionId) {
    args.push("--resume", opts.resumeSessionId);
  }

  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { cwd: opts.cwd });
    opts.onSpawn?.(child.pid);

    let buffer = "";
    let stderr = "";
    let sessionId = opts.resumeSessionId ?? "";
    let resultText = "";

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
          opts.onEvent?.(`[claude] (파싱 실패) ${line.slice(0, 300)}`);
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

    child.on("error", reject);

    child.on("close", (code) => {
      const success = code === 0;
      if (!success) {
        opts.onEvent?.(`[claude] 비정상 종료 (code ${code}): ${stderr || "(stderr 없음)"}`);
      } else if (!resultText) {
        // 종료 코드는 0인데 result 이벤트를 못 뽑아냈다면 (stdout 파싱이 전부 실패했거나,
        // claude가 아예 stream-json을 못 뱉었을 가능성) 원인 추정에 남은 유일한 단서인
        // buffer/stderr라도 남긴다 - 완전히 빈 응답으로 조용히 넘어가지 않는다.
        opts.onEvent?.(
          `[claude] 종료 코드는 0이지만 응답 텍스트를 못 읽었습니다. ` +
            `stderr: ${stderr.trim() || "(없음)"} / 남은 버퍼: ${buffer.slice(0, 300) || "(없음)"}`
        );
      }
      resolve({ sessionId, resultText: resultText || (success ? "" : stderr), success });
    });
  });
}
