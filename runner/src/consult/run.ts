import type { Employee } from "@ai-crew/shared";
import { runClaudeHeadless } from "../claude/headless.js";
import { projectPath } from "../workspace.js";

export interface ConsultResult {
  success: boolean;
  answer?: string;
  error?: string;
}

// 기획자가 ask_employee로 물어보면, 그 프로젝트 담당 직원 명의로 읽기 전용 세션을 짧게 띄워
// 답을 구한다. 티켓/워크트리가 없다 - 실제 프로젝트 폴더를 직접 열되, Read/Grep/Glob만 주어
// 절대 코드를 건드리지 않는다.
export async function runConsult(employee: Employee, project: string, question: string): Promise<ConsultResult> {
  if (employee.driver !== "claude") {
    return { success: false, error: `"${employee.driver}" 드라이버는 아직 ask_employee를 지원하지 않습니다.` };
  }

  const cwd = projectPath(project);
  const message =
    `기획자가 이 프로젝트에 새 기능을 기획하며 아래 질문을 합니다. 파일을 수정하지 말고 ` +
    `기존 코드/CLAUDE.md/.claude/skills를 조사한 내용을 바탕으로 답변만 하세요.\n\n### 질문\n${question}`;
  const systemPrompt =
    `당신은 다음 업무를 담당하는 AI 직원입니다: ${employee.taskDescription}\n` +
    `지금은 코드를 작성하는 티켓이 아니라, 기획자의 질문에 답하는 조사 세션입니다. 절대 파일을 ` +
    `수정하지 마세요.`;

  try {
    const result = await runClaudeHeadless({
      message,
      systemPrompt,
      allowedTools: ["Read", "Grep", "Glob"],
      permissionMode: "acceptEdits",
      cwd,
      model: employee.model,
    });
    return { success: result.success, answer: result.resultText || (result.success ? "(답변 없음)" : undefined) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
