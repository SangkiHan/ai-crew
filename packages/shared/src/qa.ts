// QA 담당 직원 식별은 다른 직원과 똑같이 taskDescription 자유 텍스트 기반이다 (고정 role 필드 없음).
// 팀장의 위임 판단(list_employees 보고 LLM이 고르는 것)과 달리, 이건 티켓 완료 시 서버가
// 사람 개입 없이 그 자리에서 결정해야 해서 LLM 호출 대신 키워드 매칭으로 best-effort 판단한다.
const QA_KEYWORDS = ["QA", "품질", "검증"];

export function isQaEmployee(taskDescription: string): boolean {
  const lower = taskDescription.toLowerCase();
  return QA_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}
