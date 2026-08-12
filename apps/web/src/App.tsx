import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
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

const PANEL_MIN_WIDTH = 240;
const PANEL_MAX_WIDTH = 720;
const PANEL_DEFAULT_WIDTH = 384; // 기존 w-96(24rem)과 같은 값 - 처음 쓰는 사람에게는 그대로 보인다.

function clampPanelWidth(width: number): number {
  return Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, width));
}

function loadPanelWidth(storageKey: string): number {
  const raw = localStorage.getItem(storageKey);
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? clampPanelWidth(parsed) : PANEL_DEFAULT_WIDTH;
}

// 왼쪽(팀장 대화)/오른쪽(상세 정보) 패널의 폭을 드래그로 조절한다. direction은 핸들을 오른쪽으로
// 끌 때 그 패널이 넓어져야 하는지(왼쪽 패널: +1) 좁아져야 하는지(오른쪽 패널: -1)를 정한다.
// localStorage에 저장해 새로고침해도 사용자가 맞춘 폭이 유지된다.
function useResizablePanelWidth(storageKey: string, direction: 1 | -1) {
  const [width, setWidth] = useState(() => loadPanelWidth(storageKey));
  const widthRef = useRef(width);
  widthRef.current = width;

  function startDrag(e: ReactPointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = widthRef.current;
    // 드래그 중 텍스트가 선택되면 거슬리므로 끄고, 커서도 리사이즈 모양으로 고정한다.
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    function handleMove(moveEvent: PointerEvent) {
      const next = clampPanelWidth(startWidth + direction * (moveEvent.clientX - startX));
      widthRef.current = next;
      setWidth(next);
    }
    function handleUp() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      localStorage.setItem(storageKey, String(widthRef.current));
    }
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  return [width, startDrag] as const;
}

function ResizeHandle({ onPointerDown }: { onPointerDown: (e: ReactPointerEvent) => void }) {
  return (
    <div
      onPointerDown={onPointerDown}
      className="w-1 shrink-0 cursor-col-resize bg-slate-800 transition-colors hover:bg-sky-600 active:bg-sky-500"
    />
  );
}

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
  const [leftWidth, startLeftDrag] = useResizablePanelWidth("ai-crew:panelWidth:left", 1);
  const [rightWidth, startRightDrag] = useResizablePanelWidth("ai-crew:panelWidth:right", -1);

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
            팀 설정
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
        <aside className="shrink-0 overflow-hidden" style={{ width: leftWidth }}>
          {selectedTeamId && (
            <ChatBar
              teamId={selectedTeamId}
              onOpenPlanningDocs={() => setShowPlanningDocs(true)}
              onOpenPastSessions={() => setShowPastSessions(true)}
            />
          )}
        </aside>
        <ResizeHandle onPointerDown={startLeftDrag} />
        <main className="min-w-0 flex-1">
          <OrgChart />
        </main>
        <ResizeHandle onPointerDown={startRightDrag} />
        <aside className="shrink-0 overflow-y-auto" style={{ width: rightWidth }}>
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
