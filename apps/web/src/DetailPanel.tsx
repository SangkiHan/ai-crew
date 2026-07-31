import { useEffect, useState } from "react";
import { ticketBranchName, type Ticket, type TicketStatus } from "@ai-crew/shared";
import { useStore } from "./store.js";
import { approveTicket, rejectTicket, reviseTicket } from "./lib/api.js";

const STATUS_LABEL: Record<TicketStatus, string> = {
  queued: "대기",
  assigned: "배정됨",
  running: "작업중",
  qa_review: "QA 검증중",
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

// 검수 화면에서 "어떤 프로젝트, 어떤 브랜치 작업인지 모르겠다"는 혼란을 막기 위해 항상 먼저
// 보여준다. 직원의 최종 보고(resultText)는 raw 로그를 스크롤해서 찾지 않아도 바로 읽을 수
// 있게 별도로 표시하고, diffSummary로 실제 커밋 여부를 눈에 띄게 보여줘 "승인눌렀는데 코드가
// 없는" 사고(커밋 없이 조사만 하고 끝난 세션을 그대로 승인)를 막는다.
function TicketSummary({ ticket }: { ticket: Ticket }) {
  const noCommits = ticket.diffSummary?.startsWith("커밋 없음");
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-800/40 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-400">
        <span>
          프로젝트: <span className="text-slate-200">{ticket.project}</span>
        </span>
        <span>
          브랜치: <span className="font-mono text-slate-200">{ticketBranchName(ticket.id)}</span>
        </span>
      </div>
      {ticket.diffSummary && (
        <div className={`mt-1.5 ${noCommits ? "font-medium text-amber-400" : "text-slate-400"}`}>
          {noCommits ? "⚠️ " : "변경사항: "}
          {ticket.diffSummary}
        </div>
      )}
      {ticket.resultText && (
        <div className="mt-2 border-t border-slate-700 pt-2">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">직원의 최종 보고</div>
          {/* 보고가 길면 이 박스 자체를 스크롤한다 - 전에는 높이 제한이 없어서 내용이 길면
              패널 바깥으로 잘려나가고(부모가 overflow-hidden) 스크롤도 안 돼 뒷부분을 못 봤다. */}
          <div className="max-h-56 overflow-y-auto whitespace-pre-wrap pr-1 text-slate-200">
            {ticket.resultText}
          </div>
        </div>
      )}
    </div>
  );
}

function ApprovalActions({ ticket }: { ticket: Ticket }) {
  const [pending, setPending] = useState(false);
  const [revisionText, setRevisionText] = useState("");

  async function handle(action: (id: string) => Promise<Ticket>) {
    setPending(true);
    try {
      await action(ticket.id);
    } finally {
      setPending(false);
    }
  }

  async function handleRevise() {
    const message = revisionText.trim();
    if (!message) return;
    setPending(true);
    try {
      await reviseTicket(ticket.id, message);
      setRevisionText("");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      {ticket.status === "review" && (
        <div className="flex gap-2">
          <input
            value={revisionText}
            onChange={(e) => setRevisionText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRevise();
            }}
            placeholder="수정 요청하기 (담당 직원이 이전 작업을 기억한 채로 이어서 반영합니다)"
            disabled={pending}
            className="flex-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100 outline-none focus:border-sky-500 disabled:opacity-50"
          />
          <button
            disabled={pending || !revisionText.trim()}
            onClick={handleRevise}
            className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
          >
            수정 요청
          </button>
        </div>
      )}
      <div className="flex gap-2">
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
    </div>
  );
}

export function DetailPanel() {
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const agents = useStore((s) => s.agents);
  const employees = useStore((s) => s.employees);
  // ticketsForRole은 store 안에서 안정적인 함수 참조라 이걸 구독하면 tickets가 바뀌어도
  // 리렌더링되지 않는다. tickets 객체를 직접 구독해 리렌더링을 트리거한다.
  const allTickets = useStore((s) => s.tickets);
  const logsByTicket = useStore((s) => s.logsByTicket);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  const isManager = selectedNodeId?.startsWith("manager-") ?? false;
  const manager = agents.find((a) => a.id === "manager");
  const employee = employees.find((e) => e.id === selectedNodeId);

  // 티켓의 role은 직원의 id가 아니라 name과 같다.
  const roleKey = employee?.name;
  const tickets = roleKey ? Object.values(allTickets).filter((t) => t.role === roleKey) : [];
  const sortedTickets = [...tickets].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  useEffect(() => {
    setSelectedTicketId(sortedTickets[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId]);

  const selectedTicket = sortedTickets.find((t) => t.id === selectedTicketId) ?? null;
  const logs = selectedTicketId ? logsByTicket[selectedTicketId] ?? [] : [];

  if (!selectedNodeId || (!isManager && !employee)) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-slate-500">
        조직도에서 노드를 클릭하면 상세 정보가 여기 표시됩니다.
      </div>
    );
  }

  if (isManager) {
    return (
      <div className="flex h-full flex-col gap-3 overflow-hidden p-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">{manager?.name ?? "팀장"}</h2>
          <p className="text-xs text-slate-400">{manager?.driver ?? "claude"}</p>
        </div>
        <p className="text-sm text-slate-400">
          팀장과의 대화는 왼쪽 채팅창에서 확인하세요. 팀장은 직접 코드를 수정하지 않고, 티켓을 만들어
          직원에게 위임합니다.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden p-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">{employee!.name}</h2>
        <p className="text-xs text-slate-400">
          {employee!.driver}
          {employee!.model ? ` · ${employee!.model}` : ""}
        </p>
        <p className="mt-1 text-xs text-slate-500">{employee!.taskDescription}</p>
      </div>

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

      {selectedTicket && <TicketSummary ticket={selectedTicket} />}

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
    </div>
  );
}
