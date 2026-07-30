import { useEffect, useRef, useState } from "react";
import { useStore, type ChatMessage } from "./store.js";

// zustand(React useSyncExternalStore)는 매 렌더마다 selector가 "같은" 스냅샷을 반환하는지
// 확인한다. `?? []`로 매번 새 배열을 리터럴로 만들면 참조가 계속 달라져 무한 리렌더링
// (React error #185, Maximum update depth exceeded)로 이어진다 - 고정된 참조 하나로 둔다.
const EMPTY_MESSAGES: ChatMessage[] = [];

export function ChatBar({ teamId, onOpenPlanningDocs }: { teamId: string; onOpenPlanningDocs: () => void }) {
  const chatMessages = useStore((s) => s.chatMessagesByTeam[teamId] ?? EMPTY_MESSAGES);
  const managerStatus = useStore((s) => s.managerStatusByTeam[teamId] ?? "idle");
  const sendUserMessage = useStore((s) => s.sendUserMessage);
  const [text, setText] = useState("");
  const [planningMode, setPlanningMode] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // manager_log/manager_result가 같은 메시지를 스트리밍으로 계속 갱신할 때도(길이는 안 바뀜)
  // chatMessages 배열 참조 자체가 매번 바뀌므로, 새 메시지든 갱신이든 항상 아래로 붙는다.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [chatMessages]);

  async function handleSend() {
    const message = text.trim();
    if (!message || managerStatus === "busy") return;
    setText("");
    const mode = planningMode ? "planning" : "chat";
    setPlanningMode(false);
    await sendUserMessage(teamId, message, mode);
    if (mode === "planning") onOpenPlanningDocs();
  }

  return (
    <div className="flex h-full flex-col bg-slate-900/80">
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
        <button
          onClick={() => setPlanningMode((v) => !v)}
          className={[
            "rounded-md border px-2 py-1 text-xs font-medium",
            planningMode
              ? "border-amber-500 bg-amber-500/10 text-amber-300"
              : "border-slate-700 text-slate-400 hover:bg-slate-800",
          ].join(" ")}
          title="켜면 팀장이 기획 담당 직원에게 서비스 기획서 작성을 위임합니다"
        >
          기획{planningMode ? " ✓" : ""}
        </button>
        <button onClick={onOpenPlanningDocs} className="text-xs text-slate-500 hover:text-slate-300">
          기획서 목록
        </button>
      </div>
      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-2">
        {chatMessages.length === 0 ? (
          <p className="text-sm text-slate-500">팀장에게 할 일을 말해보세요. 예: "puppynote-server에 헬스체크 추가해줘"</p>
        ) : (
          chatMessages.map((m) => (
            <div key={m.id} className={["mb-2 flex", m.role === "user" ? "justify-end" : "justify-start"].join(" ")}>
              <div
                className={[
                  "max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-1.5 text-sm",
                  m.role === "user" ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-200",
                ].join(" ")}
              >
                {m.text || (m.pending ? "…" : "")}
              </div>
            </div>
          ))
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-slate-800 p-3">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSend();
          }}
          placeholder={
            managerStatus === "busy"
              ? "팀장이 작업 중입니다…"
              : planningMode
                ? "어떤 서비스를 기획할지 말해보세요"
                : "팀장에게 지시하기"
          }
          disabled={managerStatus === "busy"}
          className="flex-1 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500 disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={managerStatus === "busy" || !text.trim()}
          className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          전송
        </button>
      </div>
    </div>
  );
}
