import type { AgentConfig, Ticket } from "@ai-crew/shared";

async function json<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? `request failed: ${res.status}`);
  return data as T;
}

export function fetchAgents(): Promise<AgentConfig[]> {
  return fetch("/api/agents").then((res) => json<AgentConfig[]>(res));
}

export function fetchTickets(): Promise<Ticket[]> {
  return fetch("/api/tickets").then((res) => json<Ticket[]>(res));
}

export function sendChatMessage(message: string): Promise<{ requestId: string }> {
  return fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  }).then((res) => json<{ requestId: string }>(res));
}

export function approveTicket(id: string): Promise<Ticket> {
  return fetch(`/api/tickets/${id}/approve`, { method: "POST" }).then((res) => json<Ticket>(res));
}

export function rejectTicket(id: string): Promise<Ticket> {
  return fetch(`/api/tickets/${id}/reject`, { method: "POST" }).then((res) => json<Ticket>(res));
}
