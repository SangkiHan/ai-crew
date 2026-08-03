import { Handle, Position, type NodeProps } from "@xyflow/react";

export type AgentNodeStatus = "idle" | "waiting" | "busy" | "attention" | "consulting";

export interface AgentNodeData {
  label: string;
  subtitle: string;
  status: AgentNodeStatus;
  isManager?: boolean;
  [key: string]: unknown;
}

const STATUS_STYLE: Record<AgentNodeStatus, { ring: string; dot: string; label: string }> = {
  idle: { ring: "ring-slate-600", dot: "bg-slate-500", label: "대기" },
  waiting: { ring: "ring-amber-500", dot: "bg-amber-400", label: "큐 대기" },
  busy: { ring: "ring-emerald-500", dot: "bg-emerald-400", label: "작업중" },
  attention: { ring: "ring-rose-500", dot: "bg-rose-400", label: "확인 필요" },
  consulting: { ring: "ring-violet-500", dot: "bg-violet-400", label: "직원 간 상담 중" },
};

export function AgentNode({ data, selected }: NodeProps & { data: AgentNodeData }) {
  const style = STATUS_STYLE[data.status];

  return (
    <div
      className={[
        "rounded-xl border border-slate-700 bg-slate-800/90 px-4 py-3 shadow-lg backdrop-blur",
        "ring-2 transition-shadow",
        style.ring,
        selected ? "outline outline-2 outline-sky-400" : "",
        // OrgChart가 직원 노드를 220px 고정 간격으로 배치하므로(OrgChart.tsx의 spacing) 노드가
        // 그보다 넓어지면 옆 노드와 겹친다 - 이름이나 모델명이 길어도 여기서 폭을 묶고 말줄임한다.
        // 상한을 바꾸려면 OrgChart의 spacing도 같이 올려야 한다.
        "max-w-[200px]",
        data.isManager ? "min-w-[160px]" : "min-w-[140px]",
      ].join(" ")}
    >
      <Handle type="target" position={Position.Top} className="!bg-slate-500" />
      <div className="flex items-center gap-2">
        <span
          className={[
            "h-2.5 w-2.5 shrink-0 rounded-full",
            style.dot,
            data.status === "busy" || data.status === "consulting" ? "animate-pulse" : "",
          ].join(" ")}
        />
        {/* flex 자식은 기본 min-width:auto라 min-w-0 없이는 truncate가 먹지 않는다. */}
        <span className="min-w-0 truncate font-semibold text-slate-100" title={data.label}>
          {data.label}
        </span>
      </div>
      <div className="mt-1 truncate text-xs text-slate-400" title={data.subtitle}>
        {data.subtitle}
      </div>
      <div className="mt-1 text-[11px] text-slate-500">{style.label}</div>
      <Handle type="source" position={Position.Bottom} className="!bg-slate-500" />
    </div>
  );
}
