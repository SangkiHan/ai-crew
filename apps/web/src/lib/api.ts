import type { AgentConfig, DriverStatus, Employee, PlanningDoc, Team, Ticket } from "@ai-crew/shared";

async function json<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? `request failed: ${res.status}`);
  return data as T;
}

export function fetchAgents(): Promise<AgentConfig[]> {
  return fetch("/api/agents").then((res) => json<AgentConfig[]>(res));
}

export function fetchTeams(): Promise<Team[]> {
  return fetch("/api/teams").then((res) => json<Team[]>(res));
}

export function createTeam(name: string): Promise<Team> {
  return fetch("/api/teams", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  }).then((res) => json<Team>(res));
}

export function deleteTeam(id: string): Promise<{ ok: true }> {
  return fetch(`/api/teams/${id}`, { method: "DELETE" }).then((res) => json<{ ok: true }>(res));
}

export function updateTeamProjects(id: string, projects: string[]): Promise<Team> {
  return fetch(`/api/teams/${id}/projects`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projects }),
  }).then((res) => json<Team>(res));
}

export function fetchTickets(): Promise<Ticket[]> {
  return fetch("/api/tickets").then((res) => json<Ticket[]>(res));
}

export function sendChatMessage(
  teamId: string,
  message: string,
  mode?: "chat" | "planning"
): Promise<{ requestId: string }> {
  return fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ teamId, message, mode }),
  }).then((res) => json<{ requestId: string }>(res));
}

export interface StoredChatMessage {
  id: string;
  teamId: string;
  role: "user" | "manager";
  text: string;
  createdAt: string;
}

export function fetchChatMessages(teamId: string): Promise<StoredChatMessage[]> {
  return fetch(`/api/chat/messages?teamId=${encodeURIComponent(teamId)}`).then((res) =>
    json<StoredChatMessage[]>(res)
  );
}

export interface ChatSessionSummary {
  id: string;
  teamId: string;
  startedAt: string;
  endedAt: string | null;
  messageCount: number;
}

export function fetchChatSessions(teamId: string): Promise<ChatSessionSummary[]> {
  return fetch(`/api/chat/sessions?teamId=${encodeURIComponent(teamId)}`).then((res) =>
    json<ChatSessionSummary[]>(res)
  );
}

export function fetchSessionMessages(sessionId: string): Promise<StoredChatMessage[]> {
  return fetch(`/api/chat/sessions/${sessionId}/messages`).then((res) => json<StoredChatMessage[]>(res));
}

// "세션 종료" - 팀장의 --resume 대상 세션과 화면 대화 기록을 둘 다 지워서 완전히 새로 시작한다.
export function endSession(teamId: string): Promise<{ ok: true }> {
  return fetch(`/api/teams/${teamId}/end-session`, { method: "POST" }).then((res) => json<{ ok: true }>(res));
}

export function fetchPlanningDocs(teamId: string): Promise<PlanningDoc[]> {
  return fetch(`/api/planning-docs?teamId=${encodeURIComponent(teamId)}`).then((res) =>
    json<PlanningDoc[]>(res)
  );
}

export function approvePlanningDoc(id: string): Promise<{ doc: PlanningDoc }> {
  return fetch(`/api/planning-docs/${id}/approve`, { method: "POST" }).then((res) =>
    json<{ doc: PlanningDoc }>(res)
  );
}

export function rejectPlanningDoc(id: string): Promise<PlanningDoc> {
  return fetch(`/api/planning-docs/${id}/reject`, { method: "POST" }).then((res) => json<PlanningDoc>(res));
}

export function revisePlanningDoc(id: string, message: string): Promise<PlanningDoc> {
  return fetch(`/api/planning-docs/${id}/revise`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  }).then((res) => json<PlanningDoc>(res));
}

export function approveTicket(id: string): Promise<Ticket> {
  return fetch(`/api/tickets/${id}/approve`, { method: "POST" }).then((res) => json<Ticket>(res));
}

export function reviseTicket(id: string, message: string): Promise<Ticket> {
  return fetch(`/api/tickets/${id}/revise`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  }).then((res) => json<Ticket>(res));
}

export function rejectTicket(id: string): Promise<Ticket> {
  return fetch(`/api/tickets/${id}/reject`, { method: "POST" }).then((res) => json<Ticket>(res));
}

export function fetchEmployees(): Promise<Employee[]> {
  return fetch("/api/employees").then((res) => json<Employee[]>(res));
}

export function createEmployee(input: {
  teamId: string;
  name: string;
  driver: string;
  model?: string;
  taskDescription: string;
  projects?: string[];
}): Promise<Employee> {
  return fetch("/api/employees", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => json<Employee>(res));
}

// 보낸 필드만 갱신한다 (담당 프로젝트 편집용). projects는 부분 patch가 아니라 전체 교체다 -
// updateTeamProjects와 같은 방식으로, UI가 항상 바뀐 전체 목록을 보낸다.
export function updateEmployee(
  id: string,
  input: Partial<{ taskDescription: string; projects: string[] }>
): Promise<Employee> {
  return fetch(`/api/employees/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => json<Employee>(res));
}

export function deleteEmployee(id: string): Promise<{ ok: true }> {
  return fetch(`/api/employees/${id}`, { method: "DELETE" }).then((res) => json<{ ok: true }>(res));
}

export function fetchDriverStatus(): Promise<Record<string, DriverStatus>> {
  return fetch("/api/driver-status").then((res) => json<Record<string, DriverStatus>>(res));
}
