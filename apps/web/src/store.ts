import { create } from "zustand";
import { isQaEmployee, type AgentConfig, type Employee, type PlanningDoc, type ServerToUiEvent, type Team, type Ticket } from "@ai-crew/shared";
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
  // ask_employee(consult)로 지금 실시간 소통 중인 직원(employeeKey = "팀id|이름") -> 동시
  // 진행 중인 상담 개수. 이름만으로 키를 잡으면 다른 팀의 동명이인 노드까지 같이 켜진다.
  // 개수로 세는 이유: 같은 직원(특히 답변자 쪽)이 동시에 여러 상담의 대상이 될 수 있어
  // 단순 on/off로는 하나가 끝났을 때 다른 하나가 아직 진행 중인데도 표시가 꺼져버린다.
  // org chart 카드에 "상담 중" 표시를 띄우기 위한 것으로, 티켓 상태와 무관하게 서버가
  // 직접 브로드캐스트한다.
  consultingEmployeeCounts: Map<string, number>;
  // 어떤 두 직원이 서로 상담 중인지("팀id|A|B" 형태, 이름 부분은 정렬됨) -> 동시 진행 개수.
  // org chart에 두 직원 카드를 잇는 선을 그리기 위한 것 - 질문자/답변자 이름이 둘 다 있을 때만
  // 채워진다 (기획 세션이 물어본 경우처럼 질문자 쪽 이름이 없으면 선을 그릴 대상이 없다).
  consultingPairCounts: Map<string, number>;

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
  ticketsForRole: (teamId: string, role: string) => Ticket[];
  statusForEmployee: (employee: Employee) => "idle" | "waiting" | "busy" | "attention" | "consulting";
}

const MAX_LOG_LINES = 500;

// 직원 이름은 팀 안에서만 유일하므로, 이름을 키로 쓰는 곳은 반드시 팀과 묶어야 한다.
export function employeeKey(teamId: string, name: string): string {
  return `${teamId}|${name}`;
}

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
  consultingEmployeeCounts: new Map(),
  consultingPairCounts: new Map(),

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
    } else if (event.type === "employee_consult_status") {
      set((s) => {
        const nextCounts = new Map(s.consultingEmployeeCounts);
        for (const name of event.employeeNames) {
          const key = employeeKey(event.teamId, name);
          const count = nextCounts.get(key) ?? 0;
          const updated = event.status === "consulting" ? count + 1 : Math.max(0, count - 1);
          if (updated === 0) nextCounts.delete(key);
          else nextCounts.set(key, updated);
        }
        const nextPairs = new Map(s.consultingPairCounts);
        if (event.employeeNames.length === 2) {
          // 상담은 항상 같은 팀 안에서 일어나므로 팀 하나로 두 참여자를 함께 식별할 수 있다.
          const key = `${event.teamId}|${[...event.employeeNames].sort().join("|")}`;
          const count = nextPairs.get(key) ?? 0;
          const updated = event.status === "consulting" ? count + 1 : Math.max(0, count - 1);
          if (updated === 0) nextPairs.delete(key);
          else nextPairs.set(key, updated);
        }
        return { consultingEmployeeCounts: nextCounts, consultingPairCounts: nextPairs };
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

  // 직원 이름(= 티켓의 role)은 팀 안에서만 유일하다 - 팀을 같이 보지 않으면 다른 팀 동명이인의
  // 티켓까지 딸려와서 엉뚱한 노드에 "작업중"이 켜진다.
  ticketsForRole: (teamId, role) =>
    Object.values(get().tickets).filter((t) => t.teamId === teamId && t.role === role),

  // 티켓의 role은 항상 "원래 담당 개발자"고, qa_review 동안에도 바뀌지 않는다 - QA 직원이
  // 실제로 세션을 돌리는 동안에도 QA 직원의 role로는 매칭되는 티켓이 하나도 없어서 QA 노드에
  // 파란불(작업중 표시)이 전혀 안 켜지는 문제가 있었다. QA 담당 직원이면 자기 팀에 qa_review
  // 티켓이 있는지로 "지금 검증 중"을 따로 판단한다. 원래 개발자 쪽은 qa_review로 넘어간 순간
  // 자기가 할 일이 없다 - QA가 반려하기 전까지는(그때 다시 running으로 돌아옴) 새 티켓을
  // 받아도 되는 상태이므로 queued/assigned(곧 시작할 일이 있는 대기)와 묶지 않고 idle로
  // 취급한다 (사용자 지적: "QA한테 넘기면 할 일 없는 직원은 대기중이어야 한다").
  statusForEmployee: (employee) => {
    if ((get().consultingEmployeeCounts.get(employeeKey(employee.teamId, employee.name)) ?? 0) > 0) {
      return "consulting";
    }
    const tickets = get().ticketsForRole(employee.teamId, employee.name);
    if (isQaEmployee(employee.taskDescription)) {
      const teamTickets = Object.values(get().tickets).filter((t) => t.teamId === employee.teamId);
      if (teamTickets.some((t) => t.status === "qa_review")) return "busy";
    }
    if (tickets.some((t) => t.status === "running")) return "busy";
    if (tickets.some((t) => t.status === "blocked" || t.status === "needs_approval")) return "attention";
    if (tickets.some((t) => t.status === "queued" || t.status === "assigned")) {
      return "waiting";
    }
    return "idle";
  },
}));
