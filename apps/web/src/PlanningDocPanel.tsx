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

// 승인/거부/수정요청을 눌렀을 때 화면에 띄우는 결과. 지금까지는 아무 표시가 없어서 눌렀는지조차
// 알 수 없었다. tone에 따라 색이 다르고, ok일 때만 잠시 뒤 패널이 자동으로 닫힌다.
// autoClose는 tone과 따로 둔다 - 거부도 성공(초록)이지만 패널을 닫을 이유는 없다. 승인만
// 닫는다(팀장이 곧 채팅에 답하기 시작하므로 그쪽으로 시선을 옮기는 게 맞다).
type ActionResult = { tone: "ok" | "warn" | "error"; text: string; autoClose?: boolean };

const AUTO_CLOSE_MS = 1800;

export function PlanningDocPanel({ teamId, onClose }: { teamId: string; onClose: () => void }) {
  const docs = useStore((s) => s.planningDocsByTeam[teamId] ?? EMPTY_DOCS);
  const setPlanningDocs = useStore((s) => s.setPlanningDocs);
  const upsertPlanningDoc = useStore((s) => s.upsertPlanningDoc);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revisionText, setRevisionText] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);

  useEffect(() => {
    fetchPlanningDocs(teamId).then((list) => setPlanningDocs(teamId, list)).catch(console.error);
  }, [teamId, setPlanningDocs]);

  useEffect(() => {
    if (!result?.autoClose) return;
    const timer = setTimeout(onClose, AUTO_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [result, onClose]);

  const sorted = [...docs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const selected = sorted.find((d) => d.id === selectedId) ?? sorted[0] ?? null;

  function toMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  async function handleApprove(doc: PlanningDoc) {
    setBusy(true);
    setResult(null);
    try {
      const { doc: updated, managerInvocation } = await approvePlanningDoc(doc.id);
      // WS 이벤트를 기다리지 않고 바로 반영한다 - 눌러도 "검토 대기"가 그대로 남아 있으면
      // 승인이 됐는지 알 수 없다.
      upsertPlanningDoc(updated);
      if (managerInvocation.ok) {
        setResult({
          tone: "ok",
          text: "승인 완료 - 팀장에게 개발 티켓 발행을 요청했습니다.",
          autoClose: true,
        });
      } else {
        // 승인 자체는 됐지만 팀장 호출이 거절된 경우. 이대로 두면 "승인했는데 개발이 시작되지
        // 않는" 상태가 되므로, 사용자가 뭘 해야 하는지까지 알려준다.
        setResult({
          tone: "warn",
          text:
            managerInvocation.reason === "busy"
              ? "승인은 완료됐지만 팀장이 다른 작업 중이라 개발 티켓 발행 요청이 전달되지 않았습니다. " +
                '팀장이 끝나면 채팅에 "승인된 기획서대로 개발 티켓을 발행해줘"라고 보내주세요.'
              : "승인은 완료됐지만 러너가 연결되어 있지 않아 팀장에게 전달되지 않았습니다. " +
                '러너를 실행한 뒤 채팅에 "승인된 기획서대로 개발 티켓을 발행해줘"라고 보내주세요.',
        });
      }
    } catch (err) {
      setResult({ tone: "error", text: `승인에 실패했습니다: ${toMessage(err)}` });
    } finally {
      setBusy(false);
    }
  }

  async function handleReject(doc: PlanningDoc) {
    setBusy(true);
    setResult(null);
    try {
      upsertPlanningDoc(await rejectPlanningDoc(doc.id));
      setResult({ tone: "ok", text: "이 기획서를 거부했습니다." });
    } catch (err) {
      setResult({ tone: "error", text: `거부에 실패했습니다: ${toMessage(err)}` });
    } finally {
      setBusy(false);
    }
  }

  async function handleRevise(doc: PlanningDoc) {
    const message = revisionText.trim();
    if (!message) return;
    setBusy(true);
    setResult(null);
    try {
      upsertPlanningDoc(await revisePlanningDoc(doc.id, message));
      setRevisionText("");
      // 수정 요청은 기획자가 다시 쓰는 동안 여기서 지켜보는 게 자연스러우니 닫지 않는다.
      setResult({ tone: "warn", text: "수정 요청을 보냈습니다. 기획자가 초안을 다시 다듬는 중입니다…" });
    } catch (err) {
      setResult({ tone: "error", text: `수정 요청에 실패했습니다: ${toMessage(err)}` });
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
                  onClick={() => {
                    setSelectedId(doc.id);
                    setResult(null); // 다른 기획서로 옮기면 이전 문서에 대한 결과 문구는 지운다
                  }}
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
              {result && (
                <div
                  className={[
                    "mx-5 mb-3 rounded-md border px-3 py-2 text-sm",
                    result.tone === "ok"
                      ? "border-emerald-700/60 bg-emerald-950/40 text-emerald-300"
                      : result.tone === "warn"
                        ? "border-amber-700/60 bg-amber-950/40 text-amber-300"
                        : "border-rose-700/60 bg-rose-950/40 text-rose-300",
                  ].join(" ")}
                >
                  {result.text}
                  {result.autoClose && (
                    <span className="ml-1 text-xs opacity-70">(잠시 후 이 창이 닫힙니다)</span>
                  )}
                </div>
              )}

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
