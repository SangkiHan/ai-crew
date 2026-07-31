import { useEffect, useState } from "react";
import { fetchChatSessions, fetchSessionMessages, type ChatSessionSummary, type StoredChatMessage } from "./lib/api.js";

// "세션 종료"로 끝난 지난 대화들을 훑어볼 수 있는 읽기 전용 패널. 지금 진행 중인 대화는
// (endedAt이 없는 세션) 이미 채팅창에 그대로 보이니 여기서는 종료된 세션 위주로 보여준다.
export function ChatSessionsPanel({ teamId, onClose }: { teamId: string; onClose: () => void }) {
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<StoredChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchChatSessions(teamId).then(setSessions).catch(console.error);
  }, [teamId]);

  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    fetchSessionMessages(selectedId)
      .then(setMessages)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [selectedId]);

  const selected = sessions.find((s) => s.id === selectedId) ?? null;

  function formatRange(s: ChatSessionSummary): string {
    const start = new Date(s.startedAt).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
    if (!s.endedAt) return `${start} ~ 진행 중`;
    const end = new Date(s.endedAt).toLocaleString("ko-KR", { timeStyle: "short" });
    return `${start} ~ ${end}`;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex h-[85vh] w-full max-w-4xl overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex w-72 shrink-0 flex-col border-r border-slate-800">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-100">지난 대화</h2>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {sessions.length === 0 ? (
              <p className="p-2 text-xs text-slate-500">아직 종료된 세션이 없습니다.</p>
            ) : (
              sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelectedId(s.id)}
                  className={[
                    "mb-1 block w-full rounded-md px-3 py-2 text-left text-xs",
                    selectedId === s.id ? "bg-slate-800" : "hover:bg-slate-800/60",
                  ].join(" ")}
                >
                  <div className="font-medium text-slate-200">{formatRange(s)}</div>
                  <div className="text-slate-500">
                    {s.messageCount}개 메시지{!s.endedAt && " · 진행 중"}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="flex flex-1 flex-col overflow-hidden">
          {!selected ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              왼쪽에서 세션을 선택하세요.
            </div>
          ) : (
            <>
              <div className="border-b border-slate-800 px-5 py-3">
                <h3 className="text-sm font-semibold text-slate-100">{formatRange(selected)}</h3>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4">
                {loading ? (
                  <p className="text-sm text-slate-500">불러오는 중…</p>
                ) : (
                  messages.map((m) => (
                    <div
                      key={m.id}
                      className={["mb-2 flex", m.role === "user" ? "justify-end" : "justify-start"].join(" ")}
                    >
                      <div
                        className={[
                          "max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-1.5 text-sm",
                          m.role === "user" ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-200",
                        ].join(" ")}
                      >
                        {m.text}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
