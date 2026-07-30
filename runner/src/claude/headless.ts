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

// claude -p 헤드리스 프로세스를 스폰하고 stream-json 출력을 파싱한다.
// 팀장(runner/src/manager)과 실제 직원 드라이버(runner/src/drivers/claude.ts) 양쪽에서 공유한다.
export function runClaudeHeadless(opts: HeadlessRunOptions): Promise<HeadlessRunResult> {
  const args = [
    "-p",
    opts.message,
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

    let buffer = "";
    let stderr = "";
    let sessionId = opts.resumeSessionId ?? "";
    let resultText = "";

    child.stdout!.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let event: any;
        try {
          event = JSON.parse(line);
        } catch {
          continue; // 부분 라인 등 - 무시
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
      }
      resolve({ sessionId, resultText: resultText || (success ? "" : stderr), success });
    });
  });
}
