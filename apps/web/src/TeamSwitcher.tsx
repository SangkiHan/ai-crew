import { useState } from "react";
import { useStore } from "./store.js";
import { createTeam, deleteTeam, fetchTeams } from "./lib/api.js";

export function TeamSwitcher() {
  const teams = useStore((s) => s.teams);
  const selectedTeamId = useStore((s) => s.selectedTeamId);
  const setTeams = useStore((s) => s.setTeams);
  const setSelectedTeamId = useStore((s) => s.setSelectedTeamId);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setTeams(await fetchTeams());
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    setError(null);
    try {
      const team = await createTeam(name);
      await refresh();
      setSelectedTeamId(team.id);
      setNewName("");
      setCreating(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDelete() {
    if (!selectedTeamId) return;
    const team = teams.find((t) => t.id === selectedTeamId);
    if (!team) return;
    if (!confirm(`"${team.name}" 팀을 삭제할까요?`)) return;
    try {
      await deleteTeam(selectedTeamId);
      const remaining = await fetchTeams();
      setTeams(remaining);
      setSelectedTeamId(remaining[0]?.id ?? null);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex items-center gap-2">
      {creating ? (
        <>
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") setCreating(false);
            }}
            placeholder="새 팀 이름"
            className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100 outline-none focus:border-sky-500"
          />
          <button
            onClick={handleCreate}
            className="rounded-md bg-sky-600 px-2 py-1 text-xs font-medium text-white hover:bg-sky-500"
          >
            만들기
          </button>
          <button
            onClick={() => setCreating(false)}
            className="text-xs text-slate-500 hover:text-slate-300"
          >
            취소
          </button>
        </>
      ) : (
        <>
          <select
            value={selectedTeamId ?? ""}
            onChange={(e) => setSelectedTeamId(e.target.value)}
            className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 outline-none focus:border-sky-500"
          >
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => setCreating(true)}
            className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
          >
            + 새 팀
          </button>
          <button
            onClick={handleDelete}
            disabled={teams.length <= 1}
            className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            팀 삭제
          </button>
        </>
      )}
      {error && <span className="text-xs text-rose-400">{error}</span>}
    </div>
  );
}
