import type { AgentConfig, DriverStatus, Employee, Team, Ticket } from "@ai-crew/shared";

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

export function fetchTickets(): Promise<Ticket[]> {
  return fetch("/api/tickets").then((res) => json<Ticket[]>(res));
}

export function sendChatMessage(teamId: string, message: string): Promise<{ requestId: string }> {
  return fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ teamId, message }),
  }).then((res) => json<{ requestId: string }>(res));
}

export function approveTicket(id: string): Promise<Ticket> {
  return fetch(`/api/tickets/${id}/approve`, { method: "POST" }).then((res) => json<Ticket>(res));
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
}): Promise<Employee> {
  return fetch("/api/employees", {
    method: "POST",
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
