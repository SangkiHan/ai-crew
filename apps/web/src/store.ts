import { create } from "zustand";
import type { AgentConfig, ChatImage, Employee, PlanningDoc, ServerToUiEvent, Team, Ticket } from "@ai-crew/shared";
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
  // 사용자 메시지에 첨부한 이미지 미리보기 (브라우저 로컬 blob URL - 서버로 보내는 base64와는 별개).
  imagePreviewUrls?: string[];
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
  planningDocsByTeam: Record<string, PlanningDoc[]>;
  selectedNodeId: string | null;

  setAgents: (agents: AgentConfig[]) => void;
  setTeams: (teams: Team[]) => void;
  setSelectedTeamId: (id: string | null) => void;
  setEmployees: (employees: Employee[]) => void;
  setTickets: (tickets: Ticket[]) => void;
  setPlanningDocs: (teamId: string, docs: PlanningDoc[]) => void;
  setSelectedNode: (id: string | null) => void;
  sendUserMessage: (
    teamId: string,
    text: string,
    mode?: "chat" | "planning",
    images?: ChatImage[],
    imagePreviewUrls?: string[]
  ) => Promise<void>;
  handleServerEvent: (event: ServerToUiEvent) => void;

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

  sendUserMessage: async (teamId, text, mode, images, imagePreviewUrls) => {
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: mode === "planning" ? `[기획] ${text}` : text,
      imagePreviewUrls,
    };
    set((s) => ({
      chatMessagesByTeam: { ...s.chatMessagesByTeam, [teamId]: [...(s.chatMessagesByTeam[teamId] ?? []), userMsg] },
    }));

    try {
      const { requestId } = await sendChatMessage(teamId, text, mode, images);
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
      set((s) => ({
        chatMessagesByTeam: {
          ...s.chatMessagesByTeam,
          [event.teamId]: (s.chatMessagesByTeam[event.teamId] ?? []).map((m) =>
            m.requestId === event.requestId ? { ...m, text: `${m.text}${m.text ? "\n" : ""}${event.line}` } : m
          ),
        },
      }));
    } else if (event.type === "manager_result") {
      set((s) => ({
        chatMessagesByTeam: {
          ...s.chatMessagesByTeam,
          [event.teamId]: (s.chatMessagesByTeam[event.teamId] ?? []).map((m) =>
            m.requestId === event.requestId
              ? { ...m, text: event.resultText || m.text, pending: false }
              : m
          ),
        },
      }));
    } else if (event.type === "planning_doc_updated") {
      set((s) => {
        const list = s.planningDocsByTeam[event.doc.teamId] ?? [];
        const idx = list.findIndex((d) => d.id === event.doc.id);
        const next = idx >= 0 ? list.map((d) => (d.id === event.doc.id ? event.doc : d)) : [...list, event.doc];
        return { planningDocsByTeam: { ...s.planningDocsByTeam, [event.doc.teamId]: next } };
      });
    }
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
