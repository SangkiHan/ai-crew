import { useEffect, useRef, useState } from "react";
import { cancelManager, launchInfraBrowser } from "./lib/api.js";
import { Markdown } from "./Markdown.js";
import { useStore, type ChatMessage } from "./store.js";

// zustand(React useSyncExternalStore)는 매 렌더마다 selector가 "같은" 스냅샷을 반환하는지
// 확인한다. `?? []`로 매번 새 배열을 리터럴로 만들면 참조가 계속 달라져 무한 리렌더링
// (React error #185, Maximum update depth exceeded)로 이어진다 - 고정된 참조 하나로 둔다.
const EMPTY_MESSAGES: ChatMessage[] = [];

export function ChatBar({
  teamId,
  onOpenPlanningDocs,
  onOpenPastSessions,
}: {
  teamId: string;
  onOpenPlanningDocs: () => void;
  onOpenPastSessions: () => void;
}) {
  const chatMessages = useStore((s) => s.chatMessagesByTeam[teamId] ?? EMPTY_MESSAGES);
  const managerStatus = useStore((s) => s.managerStatusByTeam[teamId] ?? "idle");
  const sendUserMessage = useStore((s) => s.sendUserMessage);
  const loadChatHistory = useStore((s) => s.loadChatHistory);
  const endSessionForTeam = useStore((s) => s.endSessionForTeam);
  const [text, setText] = useState("");
  const [planningMode, setPlanningMode] = useState(false);
  const [endingSession, setEndingSession] = useState(false);
  const [launchingBrowser, setLaunchingBrowser] = useState(false);
  const [cancellingManager, setCancellingManager] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // 새로고침/재접속해도 대화가 이어져 보이도록, 팀이 바뀌거나 처음 뜰 때 서버에 저장된
  // 기록을 한 번 불러온다 (이미 불러온 팀이면 loadChatHistory 내부에서 스킵한다).
  useEffect(() => {
    loadChatHistory(teamId).catch(console.error);
  }, [teamId, loadChatHistory]);

  // manager_log/manager_result가 같은 메시지를 스트리밍으로 계속 갱신할 때도(길이는 안 바뀜)
  // chatMessages 배열 참조 자체가 매번 바뀌므로, 새 메시지든 갱신이든 항상 아래로 붙는다.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [chatMessages]);

  async function handleEndSession() {
    if (!confirm("세션을 종료할까요? 대화 기록과 팀장의 이전 대화 기억이 모두 사라지고 완전히 새로 시작합니다.")) {
      return;
    }
    setEndingSession(true);
    try {
      await endSessionForTeam(teamId);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setEndingSession(false);
    }
  }

  // 러너 호스트에 --remote-debugging-port를 연 크롬을 띄운다. 여기 한 번만 로그인/이동해두면
  // INFRA_BROWSER_ENABLED가 켜진 팀장이 나중에 CDP로 이어서 조작한다(README "인프라 자동화" 참고).
  async function handleLaunchInfraBrowser() {
    setLaunchingBrowser(true);
    try {
      const result = await launchInfraBrowser();
      if (!result.success) alert(result.error ?? "크롬 실행에 실패했습니다.");
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setLaunchingBrowser(false);
    }
  }

  // 직원 티켓의 "강제 종료"(DetailPanel.tsx)와 짝을 이루는 팀장용 버튼. 서버가 즉시 busy 상태를
  // 정리하고 채팅에 취소 메시지를 남기므로, 여기서는 호출만 하면 managerStatus가 idle로
  // 바뀌면서(manager_status 브로드캐스트) 이 버튼도 자동으로 다시 숨겨진다.
  async function handleCancelManager() {
    if (!confirm("팀장 작업을 강제 종료할까요? 지금까지 진행된 내용은 남고, 응답 생성만 즉시 중단됩니다.")) {
      return;
    }
    setCancellingManager(true);
    try {
      await cancelManager(teamId);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setCancellingManager(false);
    }
  }

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
        <div className="flex items-center gap-2">
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
          <button
            onClick={handleLaunchInfraBrowser}
            disabled={launchingBrowser}
            className="rounded-md border border-slate-700 px-2 py-1 text-xs font-medium text-slate-400 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            title="원격 디버깅 포트를 연 크롬을 새로 띄웁니다. 여기서 로그인/화면 이동해두면 인프라 자동화(INFRA_BROWSER_ENABLED)가 켜진 팀장이 이어서 조작할 수 있습니다"
          >
            {launchingBrowser ? "크롬 여는 중..." : "인프라 크롬"}
          </button>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={onOpenPastSessions} className="text-xs text-slate-500 hover:text-slate-300">
            지난 대화
          </button>
          <button onClick={onOpenPlanningDocs} className="text-xs text-slate-500 hover:text-slate-300">
            기획서 목록
          </button>
          {managerStatus === "busy" && (
            <button
              onClick={handleCancelManager}
              disabled={cancellingManager}
              title="지금 응답을 생성 중인 팀장 세션을 강제로 종료합니다"
              className="text-xs text-rose-400 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {cancellingManager ? "종료 중..." : "팀장 강제 종료"}
            </button>
          )}
          <button
            onClick={handleEndSession}
            disabled={endingSession || managerStatus === "busy"}
            title="대화 기록과 팀장의 기억을 모두 지우고 완전히 새로 시작합니다"
            className="text-xs text-slate-500 hover:text-rose-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            세션 종료
          </button>
        </div>
      </div>
      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-2">
        {chatMessages.length === 0 ? (
          <p className="text-sm text-slate-500">팀장에게 할 일을 말해보세요. 예: "puppynote-server에 헬스체크 추가해줘"</p>
        ) : (
          chatMessages.map((m) => (
            <div key={m.id} className={["mb-2 flex", m.role === "user" ? "justify-end" : "justify-start"].join(" ")}>
              <div
                className={[
                  "max-w-[80%] rounded-lg px-3 py-1.5",
                  m.role === "user" ? "whitespace-pre-wrap bg-sky-600 text-sm text-white" : "bg-slate-800 text-slate-200",
                ].join(" ")}
              >
                {/* 팀장 응답은 마크다운으로 오는 경우가 많아 그대로 렌더링한다. 사용자 자신이 친
                    메시지는 마크다운으로 해석할 이유가 없으니(오히려 "*" 같은 문자를 그대로
                    보여줘야 함) 예전처럼 pre-wrap 텍스트로 남긴다. */}
                {m.role === "user" ? m.text || (m.pending ? "…" : "") : <Markdown text={m.text || (m.pending ? "…" : "")} />}
              </div>
            </div>
          ))
        )}
      </div>
      <div className="flex items-end gap-2 border-t border-slate-800 p-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter만 누르면 전송, Shift+Enter는 줄바꿈 - 여러 줄 입력이 가능해졌으니
            // 한 줄짜리 input이던 때와 동일하게 Enter로 바로 보낼 수 있어야 한다.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={
            managerStatus === "busy"
              ? "팀장이 작업 중입니다…"
              : planningMode
                ? "어떤 서비스를 기획할지 말해보세요"
                : "팀장에게 지시하기 (파일 참고가 필요하면 절대경로를 그대로 적어주세요, Shift+Enter로 줄바꿈)"
          }
          disabled={managerStatus === "busy"}
          rows={4}
          className="max-h-48 flex-1 resize-none overflow-y-auto rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500 disabled:opacity-50"
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
