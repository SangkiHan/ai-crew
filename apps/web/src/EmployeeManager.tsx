import { useEffect, useState } from "react";
import type { DriverStatus, Employee } from "@ai-crew/shared";
import { useStore } from "./store.js";
import {
  createEmployee,
  deleteEmployee,
  fetchDriverStatus,
  fetchEmployees,
  updateEmployee,
} from "./lib/api.js";

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

// 경로가 길어서 목록에서는 마지막 세그먼트만 보여준다 (전체 경로는 title 툴팁으로).
function shortProjectName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

// 팀에 등록된 프로젝트(TeamProjectsManager에서 사람이 등록한 목록) 중에서 이 직원이 담당할
// 것들을 고른다. 자유 입력이 아니라 체크박스인 이유: 티켓의 project 값과 정확히 일치해야
// 서버 검증(routes/tickets.ts)이 통과하므로, 오타나 표기 차이가 생길 여지를 없앤다.
function ProjectPicker({
  teamProjects,
  selected,
  onChange,
  disabled,
}: {
  teamProjects: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  if (teamProjects.length === 0) {
    return (
      <p className="text-xs text-slate-500">
        이 팀에 등록된 프로젝트가 없습니다. 상단 "프로젝트 관리"에서 먼저 등록하세요.
      </p>
    );
  }
  function toggle(project: string) {
    onChange(
      selected.includes(project) ? selected.filter((p) => p !== project) : [...selected, project]
    );
  }
  return (
    <div className="flex flex-col gap-1">
      {teamProjects.map((p) => (
        <label
          key={p}
          title={p}
          className="flex cursor-pointer items-center gap-2 text-xs text-slate-300 hover:text-slate-100"
        >
          <input
            type="checkbox"
            checked={selected.includes(p)}
            onChange={() => toggle(p)}
            disabled={disabled}
            className="h-3.5 w-3.5 shrink-0 accent-sky-500"
          />
          <span className="truncate">{p}</span>
        </label>
      ))}
    </div>
  );
}

export function EmployeeManager({ teamId, onClose }: { teamId: string; onClose: () => void }) {
  const allEmployees = useStore((s) => s.employees);
  const employees = allEmployees.filter((e) => e.teamId === teamId);
  const setEmployees = useStore((s) => s.setEmployees);
  const teams = useStore((s) => s.teams);
  const teamProjects = teams.find((t) => t.id === teamId)?.projects ?? [];

  const [driverStatus, setDriverStatus] = useState<Record<string, DriverStatus>>({});
  const [name, setName] = useState("");
  const [driver, setDriver] = useState("claude");
  const [model, setModel] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [projects, setProjects] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 담당 프로젝트를 편집 중인 직원 (한 번에 한 명만) - id와 편집 중인 선택 상태를 함께 들고 있다.
  const [editing, setEditing] = useState<{ id: string; projects: string[] } | null>(null);

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
      await createEmployee({
        teamId,
        name: name.trim(),
        driver,
        model: model.trim() || undefined,
        taskDescription,
        projects,
      });
      setName("");
      setModel("");
      setTaskDescription("");
      setProjects([]);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveProjects() {
    if (!editing) return;
    setSubmitting(true);
    setError(null);
    try {
      await updateEmployee(editing.id, { projects: editing.projects });
      setEditing(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    await deleteEmployee(id);
    if (editing?.id === id) setEditing(null);
    await refresh();
  }

  function renderAssignedProjects(e: Employee) {
    if (e.projects.length === 0) {
      return <span className="text-xs text-slate-600">담당 프로젝트: 전체 (지정 안 함)</span>;
    }
    return (
      <span className="text-xs text-slate-400">
        담당:{" "}
        {e.projects.map((p) => (
          <span
            key={p}
            title={p}
            className="mr-1 rounded bg-slate-700/70 px-1.5 py-0.5 text-[11px] text-slate-300"
          >
            {shortProjectName(p)}
          </span>
        ))}
      </span>
    );
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
                  className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-200">
                        {e.name}{" "}
                        <span className="text-xs text-slate-400">
                          ({DRIVER_OPTIONS.find((d) => d.value === e.driver)?.label ?? e.driver}
                          {e.model ? ` · ${e.model}` : ""})
                        </span>
                      </div>
                      <div className="text-xs text-slate-500">{e.taskDescription}</div>
                      <div className="mt-1">{renderAssignedProjects(e)}</div>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <button
                        onClick={() =>
                          setEditing(
                            editing?.id === e.id ? null : { id: e.id, projects: e.projects }
                          )
                        }
                        className="rounded-md bg-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-600"
                      >
                        {editing?.id === e.id ? "취소" : "담당 편집"}
                      </button>
                      <button
                        onClick={() => handleDelete(e.id)}
                        className="rounded-md bg-rose-600/80 px-2 py-1 text-xs text-white hover:bg-rose-600"
                      >
                        삭제
                      </button>
                    </div>
                  </div>

                  {editing?.id === e.id && (
                    <div className="mt-3 border-t border-slate-700 pt-3">
                      <p className="mb-2 text-xs text-slate-400">
                        담당 프로젝트 (아무것도 선택하지 않으면 팀의 모든 프로젝트를 담당합니다)
                      </p>
                      <ProjectPicker
                        teamProjects={teamProjects}
                        selected={editing.projects}
                        onChange={(next) => setEditing({ id: e.id, projects: next })}
                        disabled={submitting}
                      />
                      <button
                        onClick={handleSaveProjects}
                        disabled={submitting}
                        className="mt-3 rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
                      >
                        저장
                      </button>
                    </div>
                  )}
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

              <div className="rounded-md border border-slate-700 bg-slate-800/40 px-3 py-2">
                <p className="mb-2 text-xs text-slate-400">
                  담당 프로젝트 (아무것도 선택하지 않으면 팀의 모든 프로젝트를 담당합니다). 여기서
                  지정하면 팀장은 이 직원에게 그 프로젝트의 티켓만 만들 수 있습니다.
                </p>
                <ProjectPicker
                  teamProjects={teamProjects}
                  selected={projects}
                  onChange={setProjects}
                  disabled={submitting}
                />
              </div>

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
