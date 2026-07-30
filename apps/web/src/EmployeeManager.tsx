import { useEffect, useState } from "react";
import type { DriverStatus } from "@ai-crew/shared";
import { useStore } from "./store.js";
import { createEmployee, deleteEmployee, fetchDriverStatus, fetchEmployees } from "./lib/api.js";

const DRIVER_OPTIONS: { value: string; label: string }[] = [
  { value: "claude", label: "Claude Code" },
  { value: "gemini", label: "Gemini CLI" },
  { value: "codex", label: "Codex CLI" },
];

function DriverBadge({ status }: { status?: DriverStatus }) {
  if (!status) return <span className="text-xs text-slate-500">확인 중…</span>;
  if (status.installed) return <span className="text-xs text-emerald-400">설치됨</span>;
  return <span className="text-xs text-rose-400">설치 안 됨</span>;
}

function installHint(driver: string): string {
  if (driver === "claude") return "npm install -g @anthropic-ai/claude-code && claude";
  if (driver === "gemini") return "npm install -g @google/gemini-cli && gemini";
  if (driver === "codex") return "npm install -g @openai/codex && codex login";
  return "";
}

export function EmployeeManager({ teamId, onClose }: { teamId: string; onClose: () => void }) {
  const allEmployees = useStore((s) => s.employees);
  const employees = allEmployees.filter((e) => e.teamId === teamId);
  const setEmployees = useStore((s) => s.setEmployees);

  const [driverStatus, setDriverStatus] = useState<Record<string, DriverStatus>>({});
  const [name, setName] = useState("");
  const [driver, setDriver] = useState("claude");
  const [model, setModel] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDriverStatus().then(setDriverStatus).catch(() => setDriverStatus({}));
  }, []);

  async function refresh() {
    setEmployees(await fetchEmployees());
  }

  async function handleAdd() {
    if (!name.trim() || !taskDescription.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await createEmployee({ teamId, name: name.trim(), driver, model: model.trim() || undefined, taskDescription });
      setName("");
      setModel("");
      setTaskDescription("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    await deleteEmployee(id);
    await refresh();
  }

  const selectedDriverStatus = driverStatus[driver];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-100">직원 관리</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="mb-6 flex flex-col gap-1.5">
            {employees.length === 0 ? (
              <p className="text-sm text-slate-500">아직 직원이 없습니다. 아래에서 추가하세요.</p>
            ) : (
              employees.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2"
                >
                  <div>
                    <div className="text-sm font-medium text-slate-200">
                      {e.name}{" "}
                      <span className="text-xs text-slate-400">
                        ({DRIVER_OPTIONS.find((d) => d.value === e.driver)?.label ?? e.driver}
                        {e.model ? ` · ${e.model}` : ""})
                      </span>
                    </div>
                    <div className="text-xs text-slate-500">{e.taskDescription}</div>
                  </div>
                  <button
                    onClick={() => handleDelete(e.id)}
                    className="rounded-md bg-rose-600/80 px-2 py-1 text-xs text-white hover:bg-rose-600"
                  >
                    삭제
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="rounded-lg border border-slate-700 p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-200">새 직원 추가</h3>
            <div className="flex flex-col gap-3">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="이름 (예: 백엔드-홍길동)"
                className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
              />

              <div className="flex gap-2">
                {DRIVER_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setDriver(opt.value)}
                    className={[
                      "flex-1 rounded-md border px-3 py-2 text-sm",
                      driver === opt.value
                        ? "border-sky-500 bg-sky-500/10 text-sky-300"
                        : "border-slate-700 text-slate-300 hover:bg-slate-800",
                    ].join(" ")}
                  >
                    <div>{opt.label}</div>
                    <DriverBadge status={driverStatus[opt.value]} />
                  </button>
                ))}
              </div>

              {selectedDriverStatus && !selectedDriverStatus.installed && (
                <div className="rounded-md border border-amber-700/50 bg-amber-900/20 px-3 py-2 text-xs text-amber-300">
                  러너가 실행 중인 이 컴퓨터에 {DRIVER_OPTIONS.find((d) => d.value === driver)?.label}가
                  설치되어 있지 않은 것 같습니다. 터미널에서 아래 명령으로 설치하고 로그인한 뒤 다시 확인해주세요
                  (OAuth 로그인은 브라우저에서 대신 진행할 수 없습니다):
                  <code className="mt-1 block rounded bg-black/40 px-2 py-1 font-mono">
                    {installHint(driver)}
                  </code>
                </div>
              )}

              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="모델 (선택, 예: sonnet) - 비워두면 그 CLI의 기본 모델을 씁니다"
                className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
              />

              <textarea
                value={taskDescription}
                onChange={(e) => setTaskDescription(e.target.value)}
                placeholder="담당 업무 (예: puppynote-server 백엔드 담당. Spring Boot/Gradle 프로젝트)"
                rows={3}
                className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
              />

              {error && <p className="text-xs text-rose-400">{error}</p>}

              <button
                onClick={handleAdd}
                disabled={submitting || !name.trim() || !taskDescription.trim()}
                className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
              >
                추가
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
