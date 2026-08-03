import type { Employee } from "@ai-crew/shared";
import { runClaudeHeadless } from "../claude/headless.js";
import { projectPath } from "../workspace.js";

export interface ConsultResult {
  success: boolean;
  answer?: string;
  error?: string;
}

// 기획자나 동료 직원이 ask_employee로 물어보면, 그 프로젝트 담당 직원 명의로 읽기 전용 세션을
// 짧게 띄워 답을 구한다. 티켓/워크트리가 없다 - 실제 프로젝트 폴더를 직접 열되, Read/Grep/Glob만
// 주어 절대 코드를 건드리지 않는다.
export async function runConsult(
  employee: Employee,
  project: string,
  question: string,
  // 물어본 쪽이 동료 직원이면 그 이름. 기획자면 undefined다.
  fromEmployeeName?: string
): Promise<ConsultResult> {
  if (employee.driver !== "claude") {
    return { success: false, error: `"${employee.driver}" 드라이버는 아직 ask_employee를 지원하지 않습니다.` };
  }

  const cwd = projectPath(project);
  // 질문자가 누구냐에 따라 답의 성격이 다르다. 기획자는 "이런 걸 만들 수 있나"를 묻지만, 동료
  // 직원은 지금 당장 자기 티켓을 진행하려고 "그 화면이 어디고 어떤 API를 쓰냐"를 묻는다 -
  // 후자에게 기획 톤으로 답하면 정작 필요한 파일 경로/엔드포인트/필드명이 빠진다.
  const intro = fromEmployeeName
    ? `동료 직원 "${fromEmployeeName}"이(가) 지금 진행 중인 작업을 위해 이 프로젝트에 대해 아래 ` +
      `질문을 합니다. 파일을 수정하지 말고, 실제 코드를 열어 확인한 사실만으로 답하세요. ` +
      `상대는 이 프로젝트를 볼 수 없으니 짐작할 여지가 없도록 구체적으로 답하세요 - 관련 화면과 ` +
      `그 파일 경로, 호출하는 API의 메서드/경로, 주고받는 필드 이름과 타입을 명시하고, 확인해보니 ` +
      `아직 없는 것은 "없다"고 분명히 적으세요.`
    : `기획자가 이 프로젝트에 새 기능을 기획하며 아래 질문을 합니다. 파일을 수정하지 말고 ` +
      `기존 코드/CLAUDE.md/.claude/skills를 조사한 내용을 바탕으로 답변만 하세요.`;
  const message = `${intro}\n\n### 질문\n${question}`;
  const systemPrompt =
    `당신은 다음 업무를 담당하는 AI 직원입니다: ${employee.taskDescription}\n` +
    `지금은 코드를 작성하는 티켓이 아니라, ${fromEmployeeName ? "동료 직원" : "기획자"}의 질문에 ` +
    `답하는 조사 세션입니다. 절대 파일을 수정하지 마세요.`;

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
