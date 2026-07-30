import { homedir } from "node:os";
import { join } from "node:path";
import type { Employee, RunnerToServerEvent } from "@ai-crew/shared";
import { runClaudeHeadless } from "../claude/headless.js";
import { buildPlanningPrompt } from "../employees/prompt.js";

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT ?? join(homedir(), "Desktop", "Project");

// 기획서 작성은 git worktree가 필요 없다 (코드를 안 건드리므로) - WORKSPACE_ROOT를 cwd로 두고
// 필요하면 Read/Grep/Glob으로 기존 프로젝트를 참고만 하게 한다. 결과 텍스트 자체가 기획서다.
// resumeSessionId가 있으면 이전 초안과 같은 대화(--resume)를 이어서 수정 요청을 반영한다 -
// 매번 새로 쓰는 게 아니라 사람과 기획자가 티키타카로 다듬어가는 구조.
// 현재는 claude 드라이버만 지원한다 (README에 명시된 gemini/codex 제약과 같은 이유로,
// 이 환경에서 실제로 검증 가능한 건 claude뿐이다) - 다른 드라이버는 명확한 안내와 함께 실패 처리.
export async function runPlanningDoc(
  planningDocId: string,
  employee: Employee,
  message: string,
  send: (event: RunnerToServerEvent) => void,
  resumeSessionId?: string
): Promise<void> {
  const now = () => new Date().toISOString();

  if (employee.driver !== "claude") {
    send({
      type: "planning_doc_result",
      planningDocId,
      success: false,
      content: `"${employee.driver}" 드라이버는 아직 기획 기능을 지원하지 않습니다. 기획 담당 직원은 Claude Code 드라이버로 지정해주세요.`,
    });
    return;
  }

  // 최초 요청은 기획서 형식을 안내하지만, 수정 요청은 이미 세션이 그 맥락을 기억하고 있으므로
  // 사용자의 후속 지시를 그대로 전달한다.
  const fullMessage = resumeSessionId
    ? message
    : `다음 요청에 대해 상세한 서비스 기획서를 마크다운으로 작성하세요.\n\n` +
      `## 요청\n${message}\n\n` +
      `기획서에는 목적/배경, 주요 기능, 사용자 흐름, 필요한 화면/API, 우선순위(MVP 범위)를 포함하세요.`;

  try {
    const result = await runClaudeHeadless({
      message: fullMessage,
      systemPrompt: buildPlanningPrompt(employee.taskDescription),
      allowedTools: ["Read", "Grep", "Glob"],
      permissionMode: "acceptEdits",
      cwd: WORKSPACE_ROOT,
      model: employee.model,
      resumeSessionId,
      onEvent: (line) => send({ type: "planning_doc_log", planningDocId, line, ts: now() }),
    });

    send({
      type: "planning_doc_result",
      planningDocId,
      success: result.success,
      content: result.resultText || (result.success ? "" : "(기획서 생성 실패 - 세션 로그를 확인하세요)"),
      sessionId: result.sessionId,
    });
  } catch (err) {
    send({
      type: "planning_doc_result",
      planningDocId,
      success: false,
      content: err instanceof Error ? err.message : String(err),
    });
  }
}
