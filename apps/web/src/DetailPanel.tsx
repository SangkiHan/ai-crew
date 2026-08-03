import { useEffect, useRef, useState } from "react";
import { isQaEmployee, type PlanningDocStatus, type Ticket, type TicketStatus } from "@ai-crew/shared";
import { useStore } from "./store.js";
import { approveTicket, rejectTicket, reviseTicket } from "./lib/api.js";

const PLANNING_STATUS_LABEL: Record<PlanningDocStatus, string> = {
  drafting: "작성 중",
  review: "검토 대기",
  approved: "승인됨",
  rejected: "거부됨",
};

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

// done/failed는 이미 끝난 이력이다 - 기본 화면에는 지금 진행 중인 것만 보여주고,
// 이력은 사용자가 "이력" 버튼을 눌렀을 때만 보여준다.
const HISTORY_STATUSES: TicketStatus[] = ["done", "failed"];
function isHistoryTicket(ticket: Ticket): boolean {
  return HISTORY_STATUSES.includes(ticket.status);
}

// qa_review 동안 ticket.role은 원래 개발자 이름 그대로다(위 DetailPanel 주석 참고) - 그래서
// 개발자 자신의 패널에도 이 티켓이 계속 보인다. 그런데 실제로 지금 코드를 들여다보는 건 QA
// 직원이지 개발자가 아니므로, QA 직원 패널이 아닌 곳에서 "QA 검증중"이라고만 쓰면 개발자가
// 직접 검증하는 것처럼 보인다 - 사용자가 실제로 이렇게 헷갈렸다. 보는 사람이 QA 담당이 아니면
// "대기중"으로 구분해서 표시한다.
function ticketStatusLabel(status: TicketStatus, viewerIsQa: boolean): string {
  if (status === "qa_review" && !viewerIsQa) return "QA 검증 대기중";
  return STATUS_LABEL[status];
}

function TicketRow({
  ticket,
  active,
  onClick,
  viewerIsQa,
}: {
  ticket: Ticket;
  active: boolean;
  onClick: () => void;
  viewerIsQa: boolean;
}) {
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
        <span className="shrink-0 text-xs text-slate-400">{ticketStatusLabel(ticket.status, viewerIsQa)}</span>
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
          브랜치: <span className="font-mono text-slate-200">{ticket.branch ?? "(확인 중)"}</span>
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
  // blocked 티켓은 승인 개념이 없다(서버 /approve가 review/needs_approval만 받는다) - 사람이
  // 다른 방식으로 이미 해결했거나 더 진행할 필요가 없다고 판단하면 그냥 종료(삭제)만 가능하게
  // 한다. reject는 blocked -> failed도 허용하도록 서버에서 이미 열어뒀다(tickets.ts).
  const isBlocked = ticket.status === "blocked";

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
        {!isBlocked && (
          <button
            disabled={pending}
            onClick={() => handle(approveTicket)}
            className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            승인
          </button>
        )}
        <button
          disabled={pending}
          onClick={() => handle(rejectTicket)}
          className="rounded-md bg-rose-600 px-3 py-1 text-xs font-medium text-white hover:bg-rose-500 disabled:opacity-50"
        >
          {isBlocked ? "삭제 (막힘 종료)" : "거부"}
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
  const planningDocsByTeam = useStore((s) => s.planningDocsByTeam);
  const logsByTicket = useStore((s) => s.logsByTicket);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  const isManager = selectedNodeId?.startsWith("manager-") ?? false;
  const manager = agents.find((a) => a.id === "manager");
  const employee = employees.find((e) => e.id === selectedNodeId);

  // 티켓의 role은 직원의 id가 아니라 name과 같다. 단, QA 담당 직원은 티켓의 role이 자기
  // 이름으로 바뀌는 일이 절대 없다(원래 개발자 이름 그대로 유지된 채 qa_review로만 거쳐감) -
  // role로만 필터링하면 QA 직원 패널에는 항상 "배정된 티켓 없음"만 뜬다(실제로 그렇게 보여서
  // 나온 사용자 지적). QA 직원은 팀 전체의 산출물을 검증하는 역할이므로, role 대신 같은 팀의
  // 티켓 전체를 보여준다.
  const roleKey = employee?.name;
  const isQa = employee ? isQaEmployee(employee.taskDescription) : false;
  // 기획서는 티켓과 별개 모델이라 위 티켓 목록에는 절대 잡히지 않는다 - 기획을 맡은 직원은
  // 여기서 따로 꺼내와야 패널이 비어 보이지 않는다. 이력(approved/rejected)은 감춘다.
  const myPlanningDocs = employee
    ? (planningDocsByTeam[employee.teamId] ?? []).filter(
        (d) =>
          d.employeeName === employee.name &&
          (showHistory || d.status === "drafting" || d.status === "review")
      )
    : [];
  const tickets = employee
    ? isQa
      ? Object.values(allTickets).filter((t) => t.teamId === employee.teamId)
      : // role(직원 이름)은 팀 안에서만 유일하므로 팀까지 맞춰야 다른 팀 동명이인의 티켓이
        // 섞여 들어오지 않는다.
        Object.values(allTickets).filter((t) => t.teamId === employee.teamId && t.role === roleKey)
    : [];
  const sortedTickets = [...tickets].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const activeTickets = sortedTickets.filter((t) => !isHistoryTicket(t));
  // 기본값은 "지금 진행 중인 것만" - done/failed 이력은 "이력" 버튼을 눌러야 보인다.
  const visibleTickets = showHistory ? sortedTickets : activeTickets;

  useEffect(() => {
    setShowHistory(false);
    const active = tickets.filter((t) => !isHistoryTicket(t)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    setSelectedTicketId(active[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId]);

  const selectedTicket = sortedTickets.find((t) => t.id === selectedTicketId) ?? null;
  const logs = selectedTicketId ? logsByTicket[selectedTicketId] ?? [] : [];

  // 로그가 늘어날 때마다 바닥에 붙어있으면 자동으로 최하단까지 스크롤한다 - 사용자가 위로
  // 스크롤해서 과거 로그를 읽는 중이면(stickToBottomRef=false) 방해하지 않는다.
  useEffect(() => {
    const el = logContainerRef.current;
    if (el && stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs]);

  // 티켓을 바꿔 선택하면 그 티켓의 최신 로그부터 보이도록 다시 바닥에 붙인다.
  useEffect(() => {
    stickToBottomRef.current = true;
  }, [selectedTicketId]);

  function handleLogScroll() {
    const el = logContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 40;
  }

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
        {employee!.projects.length > 0 && (
          <p className="mt-1 text-xs text-slate-500" title={employee!.projects.join("\n")}>
            담당 프로젝트:{" "}
            {employee!.projects
              .map((p) => p.split(/[\\/]/).filter(Boolean).pop() ?? p)
              .join(", ")}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">
          {showHistory ? "전체 (이력 포함)" : "진행 중"}
        </span>
        <button
          onClick={() => setShowHistory((v) => !v)}
          className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
        >
          {showHistory ? "진행 중만 보기" : "이력"}
        </button>
      </div>

      <div className="flex flex-col gap-1.5 overflow-y-auto">
        {/* 기획서는 티켓이 아니라 별도 모델이라 티켓 목록에 안 잡힌다 - 기획을 맡은 직원의
            패널이 "배정된 티켓 없음"만 띄우는 걸 막기 위해 위에 따로 보여준다. */}
        {myPlanningDocs.map((d) => (
          <div
            key={d.id}
            className="rounded-lg border border-violet-800/60 bg-violet-950/20 px-3 py-2"
            title={d.request}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm text-slate-200">기획서: {d.request}</span>
              <span className="shrink-0 rounded bg-violet-900/60 px-1.5 py-0.5 text-[11px] text-violet-200">
                {PLANNING_STATUS_LABEL[d.status]}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {d.status === "drafting"
                ? "기획자가 작성 중입니다."
                : d.status === "review"
                  ? '상단 "기획서" 버튼에서 검토하고 승인/거부할 수 있습니다.'
                  : "완료된 기획서입니다."}
            </p>
          </div>
        ))}

        {visibleTickets.length === 0 ? (
          <p className="text-sm text-slate-500">
            {showHistory
              ? "아직 이 직원에게 배정된 티켓이 없습니다."
              : "지금 진행 중인 티켓이 없습니다. 지난 작업은 위 \"이력\" 버튼으로 볼 수 있습니다."}
          </p>
        ) : (
          visibleTickets.map((t) => (
            <TicketRow
              key={t.id}
              ticket={t}
              active={t.id === selectedTicketId}
              onClick={() => setSelectedTicketId(t.id)}
              viewerIsQa={isQa}
            />
          ))
        )}
      </div>

      {selectedTicket && <TicketSummary ticket={selectedTicket} />}

      {selectedTicket &&
        (selectedTicket.status === "review" ||
          selectedTicket.status === "needs_approval" ||
          selectedTicket.status === "blocked") && <ApprovalActions ticket={selectedTicket} />}

      {selectedTicket && (
        <div
          ref={logContainerRef}
          onScroll={handleLogScroll}
          className="flex-1 overflow-y-auto rounded-lg border border-slate-800 bg-black/40 p-2 font-mono text-xs text-slate-300"
        >
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
