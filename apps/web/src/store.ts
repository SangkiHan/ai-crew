import { create } from "zustand";
import type { AgentConfig, Employee, ServerToUiEvent, Ticket } from "@ai-crew/shared";
import { sendChatMessage } from "./lib/api.js";

export interface LogLine {
  line: string;
  ts: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "manager";
  text: string;
  requestId?: string;
  pending?: boolean;
}

interface StoreState {
  agents: AgentConfig[]; // 팀장 하나뿐 (agents/manager.md)
  employees: Employee[]; // 웹에서 추가/삭제하는 직원들 (DB)
  tickets: Record<string, Ticket>;
  logsByTicket: Record<string, LogLine[]>;
  managerStatus: "idle" | "busy";
  chatMessages: ChatMessage[];
  selectedNodeId: string | null;

  setAgents: (agents: AgentConfig[]) => void;
  setEmployees: (employees: Employee[]) => void;
  setTickets: (tickets: Ticket[]) => void;
  setSelectedNode: (id: string | null) => void;
  sendUserMessage: (text: string) => Promise<void>;
  handleServerEvent: (event: ServerToUiEvent) => void;

  ticketsForRole: (role: string) => Ticket[];
  statusForRole: (role: string) => "idle" | "waiting" | "busy" | "attention";
}

const MAX_LOG_LINES = 500;

export const useStore = create<StoreState>((set, get) => ({
  agents: [],
  employees: [],
  tickets: {},
  logsByTicket: {},
  managerStatus: "idle",
  chatMessages: [],
  selectedNodeId: "manager",

  setAgents: (agents) => set({ agents }),
  setEmployees: (employees) => set({ employees }),

  setTickets: (tickets) =>
    set({ tickets: Object.fromEntries(tickets.map((t) => [t.id, t])) }),

  setSelectedNode: (id) => set({ selectedNodeId: id }),

  sendUserMessage: async (text) => {
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", text };
    set((s) => ({ chatMessages: [...s.chatMessages, userMsg] }));

    try {
      const { requestId } = await sendChatMessage(text);
      const managerMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "manager",
        text: "",
        requestId,
        pending: true,
      };
      set((s) => ({ chatMessages: [...s.chatMessages, managerMsg] }));
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "manager",
        text: `(에러) ${err instanceof Error ? err.message : String(err)}`,
      };
      set((s) => ({ chatMessages: [...s.chatMessages, errorMsg] }));
    }
  },

  handleServerEvent: (event) => {
    if (event.type === "ticket_updated") {
      set((s) => ({ tickets: { ...s.tickets, [event.ticket.id]: event.ticket } }));
    } else if (event.type === "log_line") {
      set((s) => {
        const prev = s.logsByTicket[event.ticketId] ?? [];
        const next = [...prev, { line: event.line, ts: event.ts }].slice(-MAX_LOG_LINES);
        return { logsByTicket: { ...s.logsByTicket, [event.ticketId]: next } };
      });
    } else if (event.type === "manager_status") {
      set({ managerStatus: event.status });
    } else if (event.type === "manager_log") {
      set((s) => ({
        chatMessages: s.chatMessages.map((m) =>
          m.requestId === event.requestId ? { ...m, text: `${m.text}${m.text ? "\n" : ""}${event.line}` } : m
        ),
      }));
    } else if (event.type === "manager_result") {
      set((s) => ({
        chatMessages: s.chatMessages.map((m) =>
          m.requestId === event.requestId
            ? { ...m, text: event.resultText || m.text, pending: false }
            : m
        ),
      }));
    }
  },

  ticketsForRole: (role) => Object.values(get().tickets).filter((t) => t.role === role),

  statusForRole: (role) => {
    const tickets = get().ticketsForRole(role);
    if (tickets.some((t) => t.status === "running")) return "busy";
    if (tickets.some((t) => t.status === "blocked" || t.status === "needs_approval")) return "attention";
    if (tickets.some((t) => t.status === "queued" || t.status === "assigned")) return "waiting";
    return "idle";
  },
}));
