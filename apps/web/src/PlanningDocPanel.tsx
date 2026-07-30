import { useEffect, useState } from "react";
import type { PlanningDoc, PlanningDocStatus } from "@ai-crew/shared";
import { useStore } from "./store.js";
import { approvePlanningDoc, fetchPlanningDocs, rejectPlanningDoc, revisePlanningDoc } from "./lib/api.js";

const STATUS_LABEL: Record<PlanningDocStatus, string> = {
  drafting: "작성 중…",
  review: "검토 대기",
  approved: "승인됨 (개발 진행 중)",
  rejected: "거부됨",
};

const STATUS_COLOR: Record<PlanningDocStatus, string> = {
  drafting: "text-slate-400",
  review: "text-amber-400",
  approved: "text-emerald-400",
  rejected: "text-rose-400",
};

// zustand/useSyncExternalStore는 selector가 매번 "같은" 스냅샷을 반환하는지 확인한다.
// `?? []`로 매번 새 배열을 만들면 참조가 계속 달라져 무한 리렌더링(React error #185)으로
// 이어진다 (ChatBar에서 겪은 것과 같은 버그) - 고정된 참조 하나로 둔다.
const EMPTY_DOCS: PlanningDoc[] = [];

export function PlanningDocPanel({ teamId, onClose }: { teamId: string; onClose: () => void }) {
  const docs = useStore((s) => s.planningDocsByTeam[teamId] ?? EMPTY_DOCS);
  const setPlanningDocs = useStore((s) => s.setPlanningDocs);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revisionText, setRevisionText] = useState("");

  useEffect(() => {
    fetchPlanningDocs(teamId).then((list) => setPlanningDocs(teamId, list)).catch(console.error);
  }, [teamId, setPlanningDocs]);

  const sorted = [...docs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const selected = sorted.find((d) => d.id === selectedId) ?? sorted[0] ?? null;

  async function handleApprove(doc: PlanningDoc) {
    setBusy(true);
    try {
      await approvePlanningDoc(doc.id);
    } finally {
      setBusy(false);
    }
  }

  async function handleReject(doc: PlanningDoc) {
    setBusy(true);
    try {
      await rejectPlanningDoc(doc.id);
    } finally {
      setBusy(false);
    }
  }

  async function handleRevise(doc: PlanningDoc) {
    const message = revisionText.trim();
    if (!message) return;
    setBusy(true);
    try {
      await revisePlanningDoc(doc.id, message);
      setRevisionText("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex h-[85vh] w-full max-w-4xl overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex w-64 shrink-0 flex-col border-r border-slate-800">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-100">기획서</h2>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {sorted.length === 0 ? (
              <p className="p-2 text-xs text-slate-500">
                아직 기획서가 없습니다. 채팅에서 "기획" 버튼을 켜고 요청해보세요.
              </p>
            ) : (
              sorted.map((doc) => (
                <button
                  key={doc.id}
                  onClick={() => setSelectedId(doc.id)}
                  className={[
                    "mb-1 block w-full rounded-md px-3 py-2 text-left text-xs",
                    selected?.id === doc.id ? "bg-slate-800" : "hover:bg-slate-800/60",
                  ].join(" ")}
                >
                  <div className="truncate font-medium text-slate-200">{doc.request}</div>
                  <div className={STATUS_COLOR[doc.status]}>{STATUS_LABEL[doc.status]}</div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="flex flex-1 flex-col overflow-hidden">
          {!selected ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              왼쪽에서 기획서를 선택하세요.
            </div>
          ) : (
            <>
              <div className="border-b border-slate-800 px-5 py-3">
                <div className="text-sm text-slate-400">{selected.employeeName}에게 위임됨</div>
                <h3 className="text-base font-semibold text-slate-100">{selected.request}</h3>
                <div className={`text-xs ${STATUS_COLOR[selected.status]}`}>{STATUS_LABEL[selected.status]}</div>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4">
                {selected.status === "drafting" ? (
                  <p className="text-sm text-slate-500">기획서를 작성하고 있습니다…</p>
                ) : (
                  <div className="whitespace-pre-wrap text-sm text-slate-200">
                    {selected.content ?? "(내용 없음)"}
                  </div>
                )}
              </div>
              {selected.status === "review" && (
                <div className="border-t border-slate-800 px-5 py-3">
                  <div className="mb-2 flex gap-2">
                    <input
                      value={revisionText}
                      onChange={(e) => setRevisionText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRevise(selected);
                      }}
                      placeholder="이 기획서에 수정 요청하기 (예: 오픈 이슈 2번은 토글 API로 통합해줘)"
                      disabled={busy}
                      className="flex-1 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500 disabled:opacity-50"
                    />
                    <button
                      disabled={busy || !revisionText.trim()}
                      onClick={() => handleRevise(selected)}
                      className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                    >
                      수정 요청
                    </button>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      disabled={busy}
                      onClick={() => handleReject(selected)}
                      className="rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-500 disabled:opacity-50"
                    >
                      거부
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => handleApprove(selected)}
                      className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      승인하고 개발 시작
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
