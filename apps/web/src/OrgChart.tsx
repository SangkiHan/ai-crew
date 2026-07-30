import { useEffect, useMemo } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useStore } from "./store.js";
import { AgentNode, type AgentNodeData } from "./AgentNode.js";

const nodeTypes = { agent: AgentNode };

const DRIVER_LABEL: Record<string, string> = {
  claude: "Claude Code",
  gemini: "Gemini CLI",
  codex: "Codex CLI",
  mock: "mock",
};

// fitView prop은 최초 마운트 때 한 번만 적용된다. 매니저 노드만 있는 상태로 마운트된 뒤
// employees가 비동기로 로드되어 직원 노드가 추가되면, 다시 fitView를 불러줘야 새 노드가 화면에 들어온다.
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
  const selectedTeamId = useStore((s) => s.selectedTeamId);
  const allEmployees = useStore((s) => s.employees);
  const managerStatusByTeam = useStore((s) => s.managerStatusByTeam);
  // statusForRole 자체는 store 안에서 안정적인 함수 참조라 이걸 구독해서는 tickets가
  // 바뀌어도 리렌더링되지 않는다. tickets 객체를 직접 구독해 리렌더링을 트리거하고,
  // 계산은 getState()로 매번 새로 한다.
  const tickets = useStore((s) => s.tickets);
  const setSelectedNode = useStore((s) => s.setSelectedNode);

  const manager = agents.find((a) => a.id === "manager");
  const employees = useMemo(
    () => allEmployees.filter((e) => e.teamId === selectedTeamId),
    [allEmployees, selectedTeamId]
  );
  const managerStatus = (selectedTeamId && managerStatusByTeam[selectedTeamId]) || "idle";

  const { nodes, edges } = useMemo(() => {
    const statusForRole = useStore.getState().statusForRole;
    const nodes: Node<AgentNodeData>[] = [];
    const edges: Edge[] = [];

    nodes.push({
      id: "manager",
      type: "agent",
      position: { x: 260, y: 20 },
      data: {
        label: manager?.name ?? "팀장",
        subtitle: `팀장 · ${DRIVER_LABEL[manager?.driver ?? "claude"]}`,
        status: managerStatus === "busy" ? "busy" : "idle",
        isManager: true,
      },
      draggable: false,
    });

    const spacing = 220;
    const startX = 260 - ((employees.length - 1) * spacing) / 2;

    // 티켓의 role은 직원의 id가 아니라 name과 같다 (Employee.name이 그대로 role 값).
    employees.forEach((employee, i) => {
      nodes.push({
        id: employee.id,
        type: "agent",
        position: { x: startX + i * spacing, y: 200 },
        data: {
          label: employee.name,
          subtitle: `${DRIVER_LABEL[employee.driver] ?? employee.driver}${employee.model ? ` · ${employee.model}` : ""}`,
          status: statusForRole(employee.name),
        },
        draggable: false,
      });
      edges.push({
        id: `manager-${employee.id}`,
        source: "manager",
        target: employee.id,
        animated: statusForRole(employee.name) === "busy",
      });
    });

    return { nodes, edges };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents, employees, managerStatus, tickets]);

  return (
    <div className="h-full w-full">
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={(_, node) => setSelectedNode(node.id)}
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
