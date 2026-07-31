import { useEffect, useRef, useState } from "react";
import type { ChatImage } from "@ai-crew/shared";
import { useStore, type ChatMessage } from "./store.js";

// zustand(React useSyncExternalStore)는 매 렌더마다 selector가 "같은" 스냅샷을 반환하는지
// 확인한다. `?? []`로 매번 새 배열을 리터럴로 만들면 참조가 계속 달라져 무한 리렌더링
// (React error #185, Maximum update depth exceeded)로 이어진다 - 고정된 참조 하나로 둔다.
const EMPTY_MESSAGES: ChatMessage[] = [];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // "data:image/png;base64,AAAA..." 에서 실제 payload만 뗀다.
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

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
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [endingSession, setEndingSession] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  function addFiles(files: FileList | File[]) {
    const images = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (images.length > 0) setAttachedFiles((prev) => [...prev, ...images]);
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const files = Array.from(e.clipboardData.files);
    if (files.length > 0) addFiles(files);
  }

  async function handleSend() {
    const message = text.trim();
    if ((!message && attachedFiles.length === 0) || managerStatus === "busy") return;
    const filesToSend = attachedFiles;
    setText("");
    setAttachedFiles([]);
    const mode = planningMode ? "planning" : "chat";
    setPlanningMode(false);

    const images: ChatImage[] | undefined = filesToSend.length
      ? await Promise.all(
          filesToSend.map(async (f) => ({ name: f.name, mimeType: f.type, dataBase64: await fileToBase64(f) }))
        )
      : undefined;
    const previewUrls = filesToSend.length ? filesToSend.map((f) => URL.createObjectURL(f)) : undefined;

    await sendUserMessage(teamId, message || "(첨부된 이미지 참고)", mode, images, previewUrls);
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
        <div className="flex items-center gap-3">
          <button onClick={onOpenPastSessions} className="text-xs text-slate-500 hover:text-slate-300">
            지난 대화
          </button>
          <button onClick={onOpenPlanningDocs} className="text-xs text-slate-500 hover:text-slate-300">
            기획서 목록
          </button>
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
                  "max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-1.5 text-sm",
                  m.role === "user" ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-200",
                ].join(" ")}
              >
                {m.imagePreviewUrls && m.imagePreviewUrls.length > 0 && (
                  <div className="mb-1.5 flex flex-wrap gap-1.5">
                    {m.imagePreviewUrls.map((url, i) => (
                      <img key={i} src={url} className="h-20 w-20 rounded-md object-cover" />
                    ))}
                  </div>
                )}
                {m.text || (m.pending ? "…" : "")}
              </div>
            </div>
          ))
        )}
      </div>
      {attachedFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-slate-800 px-3 pt-2">
          {attachedFiles.map((f, i) => (
            <div key={i} className="relative">
              <img
                src={URL.createObjectURL(f)}
                className="h-14 w-14 rounded-md border border-slate-700 object-cover"
              />
              <button
                onClick={() => setAttachedFiles((prev) => prev.filter((_, j) => j !== i))}
                className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-rose-600 text-[10px] text-white hover:bg-rose-500"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 border-t border-slate-800 p-3">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={managerStatus === "busy"}
          title="이미지 첨부 (디자인 참고 등)"
          className="shrink-0 rounded-md border border-slate-700 px-2.5 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          📎
        </button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSend();
          }}
          onPaste={handlePaste}
          placeholder={
            managerStatus === "busy"
              ? "팀장이 작업 중입니다…"
              : planningMode
                ? "어떤 서비스를 기획할지 말해보세요"
                : "팀장에게 지시하기 (이미지는 붙여넣기도 가능)"
          }
          disabled={managerStatus === "busy"}
          className="flex-1 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500 disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={managerStatus === "busy" || (!text.trim() && attachedFiles.length === 0)}
          className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          전송
        </button>
      </div>
    </div>
  );
}
