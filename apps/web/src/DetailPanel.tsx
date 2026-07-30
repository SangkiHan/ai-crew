import { useEffect, useState } from "react";
import type { Ticket, TicketStatus } from "@ai-crew/shared";
import { useStore } from "./store.js";
import { approveTicket, rejectTicket } from "./lib/api.js";

const STATUS_LABEL: Record<TicketStatus, string> = {
  queued: "대기",
  assigned: "배정됨",
  running: "작업중",
  review: "검수 대기",
  blocked: "막힘",
  needs_approval: "승인 대기",
  done: "완료",
  failed: "실패",
};

function TicketRow({ ticket, active, onClick }: { ticket: Ticket; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={[
        "w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors",
        active ? "border-sky-500 bg-sky-500/10" : "border-slate-700 bg-slate-800/60 hover:bg-slate-800",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium text-slate-200">{ticket.title}</span>
        <span className="shrink-0 text-xs text-slate-400">{STATUS_LABEL[ticket.status]}</span>
      </div>
      <div className="mt-0.5 text-xs text-slate-500">{ticket.project}</div>
    </button>
  );
}

function ApprovalActions({ ticket }: { ticket: Ticket }) {
  const [pending, setPending] = useState(false);

  async function handle(action: (id: string) => Promise<Ticket>) {
    setPending(true);
    try {
      await action(ticket.id);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-2 flex gap-2">
      <button
        disabled={pending}
        onClick={() => handle(approveTicket)}
        className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        승인
      </button>
      <button
        disabled={pending}
        onClick={() => handle(rejectTicket)}
        className="rounded-md bg-rose-600 px-3 py-1 text-xs font-medium text-white hover:bg-rose-500 disabled:opacity-50"
      >
        거부
      </button>
    </div>
  );
}

export function DetailPanel() {
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const agents = useStore((s) => s.agents);
  // ticketsForRole은 store 안에서 안정적인 함수 참조라 이걸 구독하면 tickets가 바뀌어도
  // 리렌더링되지 않는다. tickets 객체를 직접 구독해 리렌더링을 트리거한다.
  const allTickets = useStore((s) => s.tickets);
  const logsByTicket = useStore((s) => s.logsByTicket);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  const agent = agents.find((a) => a.id === selectedNodeId);
  const tickets = selectedNodeId
    ? Object.values(allTickets).filter((t) => t.role === selectedNodeId)
    : [];
  const sortedTickets = [...tickets].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  useEffect(() => {
    setSelectedTicketId(sortedTickets[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId]);

  const selectedTicket = sortedTickets.find((t) => t.id === selectedTicketId) ?? null;
  const logs = selectedTicketId ? logsByTicket[selectedTicketId] ?? [] : [];

  if (!selectedNodeId || !agent) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-slate-500">
        조직도에서 노드를 클릭하면 상세 정보가 여기 표시됩니다.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden p-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">{agent.name}</h2>
        <p className="text-xs text-slate-400">
          {agent.driver} · {agent.projects.length ? agent.projects.join(", ") : "담당 프로젝트 없음"}
        </p>
      </div>

      {agent.id === "manager" ? (
        <p className="text-sm text-slate-400">
          팀장과의 대화는 아래 채팅창에서 확인하세요. 팀장은 직접 코드를 수정하지 않고, 티켓을 만들어
          직원에게 위임합니다.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-1.5 overflow-y-auto">
            {sortedTickets.length === 0 ? (
              <p className="text-sm text-slate-500">아직 이 직원에게 배정된 티켓이 없습니다.</p>
            ) : (
              sortedTickets.map((t) => (
                <TicketRow
                  key={t.id}
                  ticket={t}
                  active={t.id === selectedTicketId}
                  onClick={() => setSelectedTicketId(t.id)}
                />
              ))
            )}
          </div>

          {selectedTicket && (selectedTicket.status === "review" || selectedTicket.status === "needs_approval") && (
            <ApprovalActions ticket={selectedTicket} />
          )}

          {selectedTicket && (
            <div className="flex-1 overflow-y-auto rounded-lg border border-slate-800 bg-black/40 p-2 font-mono text-xs text-slate-300">
              {logs.length === 0 ? (
                <p className="text-slate-600">아직 로그가 없습니다.</p>
              ) : (
                logs.map((l, i) => (
                  <div key={i} className="whitespace-pre-wrap py-0.5">
                    {l.line}
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
