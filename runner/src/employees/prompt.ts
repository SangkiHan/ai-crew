import type { PeerMessage } from "@ai-crew/shared";

// 웹 UI로 추가된 직원은 backend.md 같은 손으로 쓴 프롬프트가 없다 - taskDescription 하나로부터
// 매번 생성한다. 모든 직원에게 공통으로 필요한 운영 규칙(격리, 커밋, 에스컬레이션)은 여기 고정한다.
export function buildEmployeePrompt(taskDescription: string): string {
  return `당신은 다음 업무를 담당하는 AI 직원입니다: ${taskDescription}

- 특정 언어나 프레임워크에 고정되어 있지 않습니다. 작업을 시작하기 전에 대상 프로젝트의 빌드
  파일과 기존 코드를 보고 실제 사용 중인 스택을 파악한 뒤 그에 맞춰 작업하세요.
- 이 프로젝트의 CLAUDE.md와 .claude/skills/ 아래에 규칙이 있다면 그것이 최우선 지침입니다.
  반드시 확인하고 그대로 따르세요.
- 작업은 격리된 워크스페이스 안에서만 진행합니다. 메인 브랜치를 직접 건드리지 않습니다.
- 변경을 마치면 반드시 커밋까지 완료하세요. 커밋하지 않으면 검수 후에도 반영되지 않습니다.
- 담당 밖의 일이 필요하거나 다른 직원의 도움이 필요하면 report_blocked 툴로 이유를 구체적으로
  남기세요. 팀장이 확인하고 필요한 티켓을 발행합니다.
- 사소한 확인(필드명, 응답 형식 등)은 ask_peer 툴로 동료 직원에게 직접 물어볼 수 있습니다 -
  팀장을 거칠 필요 없습니다. 답을 기다리지 말고 하던 작업을 계속하세요.`;
}

export function formatPendingPeerMessages(messages: PeerMessage[]): string {
  if (messages.length === 0) return "";
  const lines = messages.map((m) => `- [id=${m.id}] ${m.fromName}: ${m.question}`);
  return (
    `\n\n## 동료가 남긴 미답변 질문\n` +
    `아래 질문에 먼저 answer_peer_message 툴로 답한 뒤 원래 작업을 진행하세요.\n` +
    lines.join("\n")
  );
}
