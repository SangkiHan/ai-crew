import { useEffect, useState } from "react";
import { OrgChart } from "./OrgChart.js";
import { DetailPanel } from "./DetailPanel.js";
import { ChatBar } from "./ChatBar.js";
import { EmployeeManager } from "./EmployeeManager.js";
import { PlanningDocPanel } from "./PlanningDocPanel.js";
import { ChatSessionsPanel } from "./ChatSessionsPanel.js";
import { TeamProjectsManager } from "./TeamProjectsManager.js";
import { TeamSwitcher } from "./TeamSwitcher.js";
import { useStore } from "./store.js";
import { useUiSocket } from "./lib/ws.js";
import { fetchAgents, fetchEmployees, fetchPlanningDocs, fetchTeams, fetchTickets } from "./lib/api.js";

export function App() {
  const setAgents = useStore((s) => s.setAgents);
  const setTeams = useStore((s) => s.setTeams);
  const selectedTeamId = useStore((s) => s.selectedTeamId);
  const setSelectedTeamId = useStore((s) => s.setSelectedTeamId);
  const setEmployees = useStore((s) => s.setEmployees);
  const setTickets = useStore((s) => s.setTickets);
  const setPlanningDocs = useStore((s) => s.setPlanningDocs);
  const [managingEmployees, setManagingEmployees] = useState(false);
  const [managingProjects, setManagingProjects] = useState(false);
  const [showPlanningDocs, setShowPlanningDocs] = useState(false);
  const [showPastSessions, setShowPastSessions] = useState(false);

  useUiSocket();

  useEffect(() => {
    fetchAgents().then(setAgents).catch(console.error);
    fetchEmployees().then(setEmployees).catch(console.error);
    fetchTickets().then(setTickets).catch(console.error);
    fetchTeams().then((teams) => {
      setTeams(teams);
      // 처음 로드 시 또는 선택된 팀이 사라졌을 때(삭제 등) 첫 팀을 기본 선택한다.
      const current = useStore.getState().selectedTeamId;
      if (!current || !teams.some((t) => t.id === current)) {
        setSelectedTeamId(teams[0]?.id ?? null);
      }
    }).catch(console.error);
  }, [setAgents, setEmployees, setTickets, setTeams, setSelectedTeamId]);

  // 기획서는 지금까지 "기획서" 패널을 열 때만 불러왔다 - 그래서 패널을 한 번도 안 열면 조직도가
  // 기획 중인 직원을 알 방법이 없어서 계속 대기 상태로 보였다. 팀이 정해지면 미리 받아둔다.
  useEffect(() => {
    if (!selectedTeamId) return;
    fetchPlanningDocs(selectedTeamId)
      .then((docs) => setPlanningDocs(selectedTeamId, docs))
      .catch(console.error);
  }, [selectedTeamId, setPlanningDocs]);

  return (
    <div className="flex h-screen w-screen flex-col bg-slate-950">
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold tracking-wide text-slate-300">ai-crew</h1>
          <TeamSwitcher />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setManagingProjects(true)}
            disabled={!selectedTeamId}
            className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            프로젝트 관리
          </button>
          <button
            onClick={() => setManagingEmployees(true)}
            disabled={!selectedTeamId}
            className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            직원 관리
          </button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="w-96 shrink-0 border-r border-slate-800">
          {selectedTeamId && (
            <ChatBar
              teamId={selectedTeamId}
              onOpenPlanningDocs={() => setShowPlanningDocs(true)}
              onOpenPastSessions={() => setShowPastSessions(true)}
            />
          )}
        </aside>
        <main className="min-w-0 flex-1">
          <OrgChart />
        </main>
        <aside className="w-96 shrink-0 overflow-y-auto border-l border-slate-800">
          <DetailPanel />
        </aside>
      </div>
      {managingEmployees && selectedTeamId && (
        <EmployeeManager teamId={selectedTeamId} onClose={() => setManagingEmployees(false)} />
      )}
      {managingProjects && selectedTeamId && (
        <TeamProjectsManager teamId={selectedTeamId} onClose={() => setManagingProjects(false)} />
      )}
      {showPlanningDocs && selectedTeamId && (
        <PlanningDocPanel teamId={selectedTeamId} onClose={() => setShowPlanningDocs(false)} />
      )}
      {showPastSessions && selectedTeamId && (
        <ChatSessionsPanel teamId={selectedTeamId} onClose={() => setShowPastSessions(false)} />
      )}
    </div>
  );
}
