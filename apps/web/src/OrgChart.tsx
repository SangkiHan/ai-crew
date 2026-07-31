import { useEffect, useMemo, useRef } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useStore } from "./store.js";
import { AgentNode, type AgentNodeData } from "./AgentNode.js";

interface TeamLabelData {
  label: string;
  teamId: string;
  [key: string]: unknown;
}

function TeamLabelNode({ data }: { data: TeamLabelData }) {
  return (
    <div className="rounded-md border border-slate-700 bg-slate-900/80 px-3 py-1 text-xs font-semibold tracking-wide text-slate-400">
      {data.label}
    </div>
  );
}

interface TeamBoxData {
  teamId: string;
  [key: string]: unknown;
}

// 팀 클러스터 뒤에 깔리는 테두리 박스 - 라벨/팀장/직원 노드보다 먼저 배열에 넣어서 아래에 깔리게 한다.
function TeamBoxNode() {
  return <div className="h-full w-full rounded-2xl border border-slate-700/70 bg-slate-800/10" />;
}

const nodeTypes = { agent: AgentNode, teamLabel: TeamLabelNode, teamBox: TeamBoxNode };

const DRIVER_LABEL: Record<string, string> = {
  claude: "Claude Code",
  gemini: "Gemini CLI",
  codex: "Codex CLI",
  mock: "mock",
};

// fitView prop은 최초 마운트 때 한 번만 적용된다. 팀/직원이 비동기로 로드되어 노드가
// 추가되면, 다시 fitView를 불러줘야 새 노드가 화면에 들어온다.
function FitViewOnNodesChange({ nodeCount }: { nodeCount: number }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const raf = requestAnimationFrame(() => fitView({ padding: 0.2, duration: 200 }));
    return () => cancelAnimationFrame(raf);
  }, [nodeCount, fitView]);
  return null;
}

export function OrgChart() {
  const agents = useStore((s) => s.agents);
  const teams = useStore((s) => s.teams);
  const employees = useStore((s) => s.employees);
  const managerStatusByTeam = useStore((s) => s.managerStatusByTeam);
  // statusForRole 자체는 store 안에서 안정적인 함수 참조라 이걸 구독해서는 tickets가
  // 바뀌어도 리렌더링되지 않는다. tickets 객체를 직접 구독해 리렌더링을 트리거하고,
  // 계산은 getState()로 매번 새로 한다.
  const tickets = useStore((s) => s.tickets);
  const setSelectedNode = useStore((s) => s.setSelectedNode);
  const setSelectedTeamId = useStore((s) => s.setSelectedTeamId);

  const manager = agents.find((a) => a.id === "manager");
  const reactFlowRef = useRef<ReactFlowInstance<Node<AgentNodeData | TeamLabelData | TeamBoxData>, Edge> | null>(
    null
  );

  const { nodes, edges } = useMemo(() => {
    const statusForRole = useStore.getState().statusForRole;
    const nodes: Node<AgentNodeData | TeamLabelData | TeamBoxData>[] = [];
    const edges: Edge[] = [];

    const spacing = 220;
    const clusterGap = 160;
    const boxPaddingX = 50;
    let cursorX = 0;

    teams.forEach((team) => {
      const teamEmployees = employees.filter((e) => e.teamId === team.id);
      const clusterWidth = Math.max(teamEmployees.length, 1) * spacing;
      const managerX = cursorX + clusterWidth / 2 - spacing / 2;
      const managerStatus = managerStatusByTeam[team.id] === "busy" ? "busy" : "idle";

      // 팀 전체를 감싸는 테두리 박스 - 다른 노드보다 먼저 넣어서 뒤에 깔리게 한다.
      nodes.push({
        id: `team-box-${team.id}`,
        type: "teamBox",
        position: { x: cursorX - boxPaddingX, y: -110 },
        data: { teamId: team.id },
        style: { width: clusterWidth + boxPaddingX * 2, height: 440, zIndex: -1 },
        draggable: false,
        selectable: false,
      });

      nodes.push({
        id: `team-label-${team.id}`,
        type: "teamLabel",
        position: { x: managerX, y: -70 },
        data: { label: team.name, teamId: team.id },
        draggable: false,
      });

      nodes.push({
        id: `manager-${team.id}`,
        type: "agent",
        position: { x: managerX, y: 20 },
        data: {
          label: manager?.name ?? "팀장",
          subtitle: `팀장 · ${DRIVER_LABEL[manager?.driver ?? "claude"]}`,
          status: managerStatus,
          isManager: true,
          teamId: team.id,
        },
        draggable: false,
      });

      const startX = managerX - ((teamEmployees.length - 1) * spacing) / 2;

      // 티켓의 role은 직원의 id가 아니라 name과 같다 (Employee.name이 그대로 role 값).
      teamEmployees.forEach((employee, i) => {
        nodes.push({
          id: employee.id,
          type: "agent",
          position: { x: startX + i * spacing, y: 200 },
          data: {
            label: employee.name,
            subtitle: `${DRIVER_LABEL[employee.driver] ?? employee.driver}${employee.model ? ` · ${employee.model}` : ""}`,
            status: statusForRole(employee.name),
            teamId: team.id,
          },
          draggable: false,
        });
        edges.push({
          id: `manager-${team.id}-${employee.id}`,
          source: `manager-${team.id}`,
          target: employee.id,
          animated: statusForRole(employee.name) === "busy",
        });
      });

      cursorX += clusterWidth + clusterGap;
    });

    return { nodes, edges };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents, teams, employees, managerStatusByTeam, tickets]);

  return (
    <div className="h-full w-full">
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onInit={(instance) => {
            reactFlowRef.current = instance;
          }}
          onNodeClick={(_, node) => {
            const teamId = (node.data as { teamId?: string }).teamId;
            if (node.type === "agent") setSelectedNode(node.id);
            if (teamId) {
              setSelectedTeamId(teamId);
              const teamNodeIds = nodes
                .filter((n) => (n.data as { teamId?: string }).teamId === teamId)
                .map((n) => ({ id: n.id }));
              reactFlowRef.current?.fitView({ nodes: teamNodeIds, duration: 300, padding: 0.4 });
            }
          }}
          onPaneClick={() => {
            reactFlowRef.current?.fitView({ padding: 0.2, duration: 300 });
          }}
          fitView
          proOptions={{ hideAttribution: true }}
          selectionKeyCode={null}
        >
          <Background color="#334155" gap={24} />
          <Controls showInteractive={false} />
          <FitViewOnNodesChange nodeCount={nodes.length} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
