import { create } from "zustand";
import type { AgentConfig, Employee, PlanningDoc, ServerToUiEvent, Team, Ticket } from "@ai-crew/shared";
import { endSession, fetchChatMessages, sendChatMessage } from "./lib/api.js";

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
  agents: AgentConfig[]; // 팀장 하나뿐 (agents/manager.md) - 프롬프트/설정은 모든 팀이 공유
  teams: Team[];
  selectedTeamId: string | null;
  employees: Employee[]; // 웹에서 추가/삭제하는 직원들 (DB, 전체 팀)
  tickets: Record<string, Ticket>;
  logsByTicket: Record<string, LogLine[]>;
  // 팀마다 팀장 대화(세션)와 바쁨 상태가 분리된다 - teamId로 구분해서 들고 있는다.
  managerStatusByTeam: Record<string, "idle" | "busy">;
  chatMessagesByTeam: Record<string, ChatMessage[]>;
  // 새로고침해도 다시 안 불러오도록, 이미 서버 기록을 불러온 팀은 표시해둔다.
  chatHistoryLoadedTeamIds: Set<string>;
  planningDocsByTeam: Record<string, PlanningDoc[]>;
  selectedNodeId: string | null;

  setAgents: (agents: AgentConfig[]) => void;
  setTeams: (teams: Team[]) => void;
  setSelectedTeamId: (id: string | null) => void;
  setEmployees: (employees: Employee[]) => void;
  setTickets: (tickets: Ticket[]) => void;
  setPlanningDocs: (teamId: string, docs: PlanningDoc[]) => void;
  setSelectedNode: (id: string | null) => void;
  sendUserMessage: (teamId: string, text: string, mode?: "chat" | "planning") => Promise<void>;
  handleServerEvent: (event: ServerToUiEvent) => void;
  loadChatHistory: (teamId: string) => Promise<void>;
  endSessionForTeam: (teamId: string) => Promise<void>;

  employeesForTeam: (teamId: string) => Employee[];
  ticketsForRole: (role: string) => Ticket[];
  statusForRole: (role: string) => "idle" | "waiting" | "busy" | "attention";
}

const MAX_LOG_LINES = 500;

export const useStore = create<StoreState>((set, get) => ({
  agents: [],
  teams: [],
  selectedTeamId: null,
  employees: [],
  tickets: {},
  logsByTicket: {},
  managerStatusByTeam: {},
  chatMessagesByTeam: {},
  chatHistoryLoadedTeamIds: new Set(),
  planningDocsByTeam: {},
  selectedNodeId: null,

  setAgents: (agents) => set({ agents }),
  setTeams: (teams) => set({ teams }),
  setSelectedTeamId: (id) => set({ selectedTeamId: id }),
  setEmployees: (employees) => set({ employees }),

  setTickets: (tickets) =>
    set({ tickets: Object.fromEntries(tickets.map((t) => [t.id, t])) }),

  setPlanningDocs: (teamId, docs) =>
    set((s) => ({ planningDocsByTeam: { ...s.planningDocsByTeam, [teamId]: docs } })),

  setSelectedNode: (id) => set({ selectedNodeId: id }),

  sendUserMessage: async (teamId, text, mode) => {
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: mode === "planning" ? `[기획] ${text}` : text,
    };
    set((s) => ({
      chatMessagesByTeam: { ...s.chatMessagesByTeam, [teamId]: [...(s.chatMessagesByTeam[teamId] ?? []), userMsg] },
    }));

    try {
      const { requestId } = await sendChatMessage(teamId, text, mode);
      const managerMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "manager",
        text: "",
        requestId,
        pending: true,
      };
      set((s) => ({
        chatMessagesByTeam: {
          ...s.chatMessagesByTeam,
          [teamId]: [...(s.chatMessagesByTeam[teamId] ?? []), managerMsg],
        },
      }));
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "manager",
        text: `(에러) ${err instanceof Error ? err.message : String(err)}`,
      };
      set((s) => ({
        chatMessagesByTeam: {
          ...s.chatMessagesByTeam,
          [teamId]: [...(s.chatMessagesByTeam[teamId] ?? []), errorMsg],
        },
      }));
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
      set((s) => ({ managerStatusByTeam: { ...s.managerStatusByTeam, [event.teamId]: event.status } }));
    } else if (event.type === "manager_log") {
      set((s) => {
        const list = s.chatMessagesByTeam[event.teamId] ?? [];
        const idx = list.findIndex((m) => m.requestId === event.requestId);
        if (idx >= 0) {
          const updated = [...list];
          updated[idx] = { ...updated[idx], text: `${updated[idx].text}${updated[idx].text ? "\n" : ""}${event.line}` };
          return { chatMessagesByTeam: { ...s.chatMessagesByTeam, [event.teamId]: updated } };
        }
        // 사용자가 채팅으로 직접 보낸 게 아니라 서버가 자동으로 깨운 팀장 호출(티켓 완료/블락
        // 알림 등)이면, sendUserMessage가 미리 만들어두는 자리표시자 메시지가 없다 - 그래서
        // 새로고침 전까지는 채팅창에 아예 안 나타났다. 여기서 새로 만들어서 바로 보이게 한다.
        const newMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: "manager",
          text: event.line,
          requestId: event.requestId,
          pending: true,
        };
        return { chatMessagesByTeam: { ...s.chatMessagesByTeam, [event.teamId]: [...list, newMsg] } };
      });
    } else if (event.type === "manager_result") {
      set((s) => {
        const list = s.chatMessagesByTeam[event.teamId] ?? [];
        const idx = list.findIndex((m) => m.requestId === event.requestId);
        if (idx >= 0) {
          const updated = [...list];
          updated[idx] = { ...updated[idx], text: event.resultText || updated[idx].text, pending: false };
          return { chatMessagesByTeam: { ...s.chatMessagesByTeam, [event.teamId]: updated } };
        }
        // manager_log를 하나도 못 받고 바로 결과만 온 경우(짧은 자동 호출)도 같은 이유로 대비.
        const newMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: "manager",
          text: event.resultText,
          requestId: event.requestId,
          pending: false,
        };
        return { chatMessagesByTeam: { ...s.chatMessagesByTeam, [event.teamId]: [...list, newMsg] } };
      });
    } else if (event.type === "planning_doc_updated") {
      set((s) => {
        const list = s.planningDocsByTeam[event.doc.teamId] ?? [];
        const idx = list.findIndex((d) => d.id === event.doc.id);
        const next = idx >= 0 ? list.map((d) => (d.id === event.doc.id ? event.doc : d)) : [...list, event.doc];
        return { planningDocsByTeam: { ...s.planningDocsByTeam, [event.doc.teamId]: next } };
      });
    }
  },

  loadChatHistory: async (teamId) => {
    if (get().chatHistoryLoadedTeamIds.has(teamId)) return; // 이미 불러온 팀 - 다시 안 불러온다
    const stored = await fetchChatMessages(teamId);
    set((s) => ({
      chatMessagesByTeam: {
        ...s.chatMessagesByTeam,
        [teamId]: stored.map((m) => ({ id: m.id, role: m.role, text: m.text })),
      },
      chatHistoryLoadedTeamIds: new Set(s.chatHistoryLoadedTeamIds).add(teamId),
    }));
  },

  endSessionForTeam: async (teamId) => {
    await endSession(teamId);
    set((s) => ({
      chatMessagesByTeam: { ...s.chatMessagesByTeam, [teamId]: [] },
      managerStatusByTeam: { ...s.managerStatusByTeam, [teamId]: "idle" },
    }));
  },

  employeesForTeam: (teamId) => get().employees.filter((e) => e.teamId === teamId),

  ticketsForRole: (role) => Object.values(get().tickets).filter((t) => t.role === role),

  statusForRole: (role) => {
    const tickets = get().ticketsForRole(role);
    if (tickets.some((t) => t.status === "running" || t.status === "qa_review")) return "busy";
    if (tickets.some((t) => t.status === "blocked" || t.status === "needs_approval")) return "attention";
    if (tickets.some((t) => t.status === "queued" || t.status === "assigned")) return "waiting";
    return "idle";
  },
}));
