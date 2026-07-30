import { useEffect, useState } from "react";
import { OrgChart } from "./OrgChart.js";
import { DetailPanel } from "./DetailPanel.js";
import { ChatBar } from "./ChatBar.js";
import { EmployeeManager } from "./EmployeeManager.js";
import { useStore } from "./store.js";
import { useUiSocket } from "./lib/ws.js";
import { fetchAgents, fetchEmployees, fetchTickets } from "./lib/api.js";

export function App() {
  const setAgents = useStore((s) => s.setAgents);
  const setEmployees = useStore((s) => s.setEmployees);
  const setTickets = useStore((s) => s.setTickets);
  const [managingEmployees, setManagingEmployees] = useState(false);

  useUiSocket();

  useEffect(() => {
    fetchAgents().then(setAgents).catch(console.error);
    fetchEmployees().then(setEmployees).catch(console.error);
    fetchTickets().then(setTickets).catch(console.error);
  }, [setAgents, setEmployees, setTickets]);

  return (
    <div className="flex h-screen w-screen flex-col bg-slate-950">
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
        <h1 className="text-sm font-semibold tracking-wide text-slate-300">ai-crew</h1>
        <button
          onClick={() => setManagingEmployees(true)}
          className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:bg-slate-800"
        >
          직원 관리
        </button>
      </header>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <main className="min-w-0 flex-1">
          <OrgChart />
        </main>
        <aside className="w-96 shrink-0 overflow-y-auto border-l border-slate-800">
          <DetailPanel />
        </aside>
      </div>
      <div className="h-64 shrink-0">
        <ChatBar />
      </div>
      {managingEmployees && <EmployeeManager onClose={() => setManagingEmployees(false)} />}
    </div>
  );
}
