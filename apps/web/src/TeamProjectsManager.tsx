import { useState } from "react";
import { DRIVER_MODEL_OPTIONS } from "@ai-crew/shared";
import { useStore } from "./store.js";
import { updateTeamManagerModel, updateTeamProjects } from "./lib/api.js";

// 팀장은 항상 claude 드라이버로 실행되므로(agents/manager.md), 모델 선택지는 직원 관리에서
// claude 직원에게 쓰는 것과 같은 목록을 그대로 재사용한다.
const MANAGER_MODEL_OPTIONS = DRIVER_MODEL_OPTIONS.claude;

// 팀이 담당하는 프로젝트 이름/절대경로 목록과 팀장 모델을 관리한다. 프로젝트 목록은 팀장 호출 시
// 시스템 프롬프트에 그대로 포함되어, list_projects MCP 툴 연결 여부와 무관하게 팀장이 자기 담당
// 프로젝트를 확실히 알 수 있게 한다 (선택 사항 - 비워두면 기존처럼 list_projects로 스캔).
export function TeamProjectsManager({ teamId, onClose }: { teamId: string; onClose: () => void }) {
  const teams = useStore((s) => s.teams);
  const setTeams = useStore((s) => s.setTeams);
  const team = teams.find((t) => t.id === teamId);

  const [newProject, setNewProject] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelSubmitting, setModelSubmitting] = useState(false);

  async function save(nextProjects: string[]) {
    setSubmitting(true);
    setError(null);
    try {
      const updated = await updateTeamProjects(teamId, nextProjects);
      setTeams(teams.map((t) => (t.id === teamId ? updated : t)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  // null = agents/manager.md 프론트매터의 기본 모델을 그대로 쓴다("기본값" 선택지).
  async function saveModel(model: string | null) {
    setModelSubmitting(true);
    setError(null);
    try {
      const updated = await updateTeamManagerModel(teamId, model);
      setTeams(teams.map((t) => (t.id === teamId ? updated : t)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setModelSubmitting(false);
    }
  }

  async function handleAdd() {
    const value = newProject.trim();
    if (!value || !team) return;
    if (team.projects.includes(value)) {
      setNewProject("");
      return;
    }
    await save([...team.projects, value]);
    setNewProject("");
  }

  async function handleRemove(project: string) {
    if (!team) return;
    await save(team.projects.filter((p) => p !== project));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-100">팀 설정 ({team?.name})</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <h3 className="mb-2 text-sm font-semibold text-slate-200">팀장 모델</h3>
          <p className="mb-3 text-xs text-slate-500">
            이 팀 팀장 세션에 쓸 모델입니다. 직원처럼 팀마다 다르게 고를 수 있습니다 - "기본값"은
            agents/manager.md에 정의된 기본 모델을 그대로 씁니다.
          </p>
          <div className="mb-6 flex flex-wrap gap-2">
            <button
              onClick={() => saveModel(null)}
              disabled={modelSubmitting}
              className={[
                "rounded-md border px-3 py-1.5 text-xs disabled:opacity-50",
                !team?.managerModel
                  ? "border-sky-500 bg-sky-500/10 text-sky-300"
                  : "border-slate-700 text-slate-300 hover:bg-slate-800",
              ].join(" ")}
            >
              기본값
            </button>
            {MANAGER_MODEL_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => saveModel(opt.value)}
                disabled={modelSubmitting}
                className={[
                  "rounded-md border px-3 py-1.5 text-xs disabled:opacity-50",
                  team?.managerModel === opt.value
                    ? "border-sky-500 bg-sky-500/10 text-sky-300"
                    : "border-slate-700 text-slate-300 hover:bg-slate-800",
                ].join(" ")}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <h3 className="mb-2 text-sm font-semibold text-slate-200">담당 프로젝트</h3>
          <p className="mb-4 text-xs text-slate-500">
            이 팀이 담당하는 프로젝트의 <strong className="text-slate-400">절대경로</strong>를
            등록하세요 (WORKSPACE_ROOT 밖의 다른 위치도 그대로 가능합니다 - 프로젝트가 실제로 있는
            폴더 경로를 그대로 넣으면 됩니다). 등록된 목록은 팀장이 호출될 때마다 시스템 프롬프트에
            그대로 포함되어 우선 참고됩니다. 비워두면 팀장은 지금처럼 WORKSPACE_ROOT를
            list_projects로 스캔해서 찾습니다.
          </p>

          <div className="mb-4 flex flex-col gap-1.5">
            {!team || team.projects.length === 0 ? (
              <p className="text-sm text-slate-500">아직 등록된 프로젝트가 없습니다.</p>
            ) : (
              team.projects.map((p) => (
                <div
                  key={p}
                  className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2"
                >
                  <span className="truncate text-sm text-slate-200">{p}</span>
                  <button
                    onClick={() => handleRemove(p)}
                    disabled={submitting}
                    className="ml-2 shrink-0 rounded-md bg-rose-600/80 px-2 py-1 text-xs text-white hover:bg-rose-600 disabled:opacity-50"
                  >
                    삭제
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="flex gap-2">
            <input
              value={newProject}
              onChange={(e) => setNewProject(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
              }}
              placeholder="예: C:\Users\tkdrl\Desktop\Project\cleaning (다른 드라이브/위치도 가능)"
              className="flex-1 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
            />
            <button
              onClick={handleAdd}
              disabled={submitting || !newProject.trim()}
              className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              추가
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
        </div>
      </div>
    </div>
  );
}
