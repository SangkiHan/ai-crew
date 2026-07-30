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
