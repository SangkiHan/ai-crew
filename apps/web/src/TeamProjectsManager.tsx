import { useState } from "react";
import { useStore } from "./store.js";
import { updateTeamProjects } from "./lib/api.js";

// 팀이 담당하는 프로젝트 이름/절대경로 목록을 관리한다. 팀장 호출 시 이 목록이 시스템
// 프롬프트에 그대로 포함되어, list_projects MCP 툴 연결 여부와 무관하게 팀장이 자기 담당
// 프로젝트를 확실히 알 수 있게 한다 (선택 사항 - 비워두면 기존처럼 list_projects로 스캔).
export function TeamProjectsManager({ teamId, onClose }: { teamId: string; onClose: () => void }) {
  const teams = useStore((s) => s.teams);
  const setTeams = useStore((s) => s.setTeams);
  const team = teams.find((t) => t.id === teamId);

  const [newProject, setNewProject] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          <h2 className="text-base font-semibold text-slate-100">프로젝트 관리 ({team?.name})</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <p className="mb-4 text-xs text-slate-500">
            이 팀이 담당하는 프로젝트 이름(WORKSPACE_ROOT 아래 폴더 이름) 또는 절대경로를 등록하면,
            팀장이 호출될 때마다 이 목록을 우선 참고합니다. 비워두면 팀장은 지금처럼
            list_projects로 폴더를 스캔해서 찾습니다.
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
              placeholder="예: cleaning 또는 C:\Users\...\Project\cleaning"
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
