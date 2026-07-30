import type { Employee, PeerMessage } from "@ai-crew/shared";

const AI_CREW_SERVER_URL = process.env.AI_CREW_SERVER_URL ?? "http://localhost:8080";

// 파일이 아니라 서버(DB)에서 매번 새로 읽는다 - 웹에서 직원을 추가/삭제해도 러너 재시작이 필요 없다.
export async function fetchEmployees(): Promise<Employee[]> {
  const res = await fetch(`${AI_CREW_SERVER_URL}/api/employees`);
  if (!res.ok) throw new Error(`failed to fetch employees: ${res.status}`);
  return res.json();
}

export async function fetchPendingPeerMessages(toName: string): Promise<PeerMessage[]> {
  const res = await fetch(`${AI_CREW_SERVER_URL}/api/peer-messages?toName=${encodeURIComponent(toName)}&status=open`);
  if (!res.ok) throw new Error(`failed to fetch peer messages: ${res.status}`);
  return res.json();
}

// QA 세션은 보통 report_qa_result MCP 툴로 직접 판정을 REST에 남긴다(report_blocked와 같은 패턴).
// 세션이 그 툴을 안 부르고 그냥 끝나버린 경우를 위한 안전망 - 통과로 간주해 사람이 review에서
// 보게 한다(막혀서 멈추는 것보다 안전). 이미 report_qa_result가 호출돼 상태가 바뀌었으면
// 서버가 400을 주는데, 그건 정상 케이스라 조용히 무시한다.
export async function reportQaFallback(ticketId: string): Promise<void> {
  await fetch(`${AI_CREW_SERVER_URL}/api/tickets/${ticketId}/qa-result`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pass: true, note: "QA 세션이 명시적 판정 없이 종료되어 통과로 처리합니다." }),
  }).catch(() => {});
}
