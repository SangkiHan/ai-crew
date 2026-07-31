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
        data.isManager ? "min-w-[160px]" : "min-w-[140px]",
      ].join(" ")}
    >
      <Handle type="target" position={Position.Top} className="!bg-slate-500" />
      <div className="flex items-center gap-2">
        <span
          className={[
            "h-2.5 w-2.5 rounded-full",
            style.dot,
            data.status === "busy" || data.status === "consulting" ? "animate-pulse" : "",
          ].join(" ")}
        />
        <span className="font-semibold text-slate-100">{data.label}</span>
      </div>
      <div className="mt-1 text-xs text-slate-400">{data.subtitle}</div>
      <div className="mt-1 text-[11px] text-slate-500">{style.label}</div>
      <Handle type="source" position={Position.Bottom} className="!bg-slate-500" />
    </div>
  );
}
