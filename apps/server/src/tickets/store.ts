import { PrismaClient } from "@prisma/client";
import { EventEmitter } from "node:events";
import { canTransition, type Ticket, type TicketStatus } from "@ai-crew/shared";

const prisma = new PrismaClient();

export const ticketEvents = new EventEmitter();

const ORPHAN_STATUSES: TicketStatus[] = ["queued", "assigned", "running"];

// 같은 티켓에 대한 상태 변경(전이/메타 갱신)을 순서대로 처리하기 위한 락.
// 러너 재연결 시 recoverAndAssign과 소켓 메시지 핸들러가 동시에 같은 티켓을 건드릴 수 있어
// (예: 새 연결의 assign 시도와 직원이 보낸 job_status가 겹침) 직렬화가 필요하다.
const ticketLocks = new Map<string, Promise<unknown>>();

function withTicketLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = ticketLocks.get(id) ?? Promise.resolve();
  const run = prev.then(fn);
  ticketLocks.set(
    id,
    run.then(
      () => undefined,
      () => undefined
    )
  );
  return run;
}

function toTicket(row: {
  id: string;
  teamId: string | null;
  role: string;
  project: string;
  title: string;
  spec: string;
  status: string;
  parentTicketId: string | null;
  sessionId: string | null;
  worktreePath: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastHeartbeatAt: Date | null;
  qaCycles: number;
  qaNote: string | null;
}): Ticket {
  return {
    id: row.id,
    // ensureDefaultTeamAssigned가 부팅 시 채워 넣으므로 실제로는 항상 값이 있다.
    teamId: row.teamId ?? "",
    role: row.role as Ticket["role"],
    project: row.project,
    title: row.title,
    spec: row.spec,
    status: row.status as TicketStatus,
    parentTicketId: row.parentTicketId,
    sessionId: row.sessionId,
    worktreePath: row.worktreePath,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastHeartbeatAt: row.lastHeartbeatAt ? row.lastHeartbeatAt.toISOString() : null,
    qaCycles: row.qaCycles,
    qaNote: row.qaNote,
  };
}

export async function createTicket(input: {
  teamId: string;
  role: string;
  project: string;
  title: string;
  spec: string;
  parentTicketId?: string | null;
}): Promise<Ticket> {
  const row = await prisma.ticket.create({
    data: { ...input, status: "queued" },
  });
  const ticket = toTicket(row);
  ticketEvents.emit("changed", ticket);
  return ticket;
}

export async function getTicket(id: string): Promise<Ticket | null> {
  const row = await prisma.ticket.findUnique({ where: { id } });
  return row ? toTicket(row) : null;
}

export async function listTickets(status?: string, teamId?: string): Promise<Ticket[]> {
  const where: Record<string, string> = {};
  if (status) where.status = status;
  if (teamId) where.teamId = teamId;
  const rows = await prisma.ticket.findMany({
    where: Object.keys(where).length ? where : undefined,
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toTicket);
}

// 서버가 재시작되거나 러너가 죽었다 붙었을 때 다시 밀어줘야 할 티켓들
export async function findOrphaned(): Promise<Ticket[]> {
  const rows = await prisma.ticket.findMany({
    where: { status: { in: ORPHAN_STATUSES } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toTicket);
}

// 이 티켓이 다른(blocked) 티켓을 풀어주려고 팀장이 만든 것이었다면, done이 되는 순간
// 원래 막혀있던 티켓을 자동으로 재개시킨다 (blocked -> queued -> 러너가 다시 집어간다).
// done으로 가는 경로가 두 곳(사람 승인, QA 자동완료)이라 공통으로 뺐다.
async function resumeParentIfBlocked(ticket: Ticket): Promise<void> {
  if (!ticket.parentTicketId) return;
  const parent = await getTicket(ticket.parentTicketId);
  if (parent?.status === "blocked") {
    await transitionTicket(parent.id, "queued");
  }
}

export async function transitionTicket(id: string, to: TicketStatus): Promise<Ticket> {
  const ticket = await withTicketLock(id, async () => {
    const current = await prisma.ticket.findUniqueOrThrow({ where: { id } });
    const from = current.status as TicketStatus;
    if (!canTransition(from, to)) {
      throw new Error(`invalid ticket transition ${from} -> ${to} (ticket ${id})`);
    }
    const row = await prisma.ticket.update({ where: { id }, data: { status: to } });
    const t = toTicket(row);
    ticketEvents.emit("changed", t);
    return t;
  });

  if (to === "done") await resumeParentIfBlocked(ticket);

  return ticket;
}

// 큐에 있던 티켓을 "배정됨"으로 표시한다. 이미 assigned/running 등으로 넘어갔다면
// (동시에 들어온 다른 assign 시도가 먼저 처리된 경우) 조용히 현재 상태를 그대로 반환한다.
export async function ensureAssigned(id: string): Promise<Ticket> {
  return withTicketLock(id, async () => {
    const current = await prisma.ticket.findUniqueOrThrow({ where: { id } });
    if (current.status !== "queued") return toTicket(current);
    const row = await prisma.ticket.update({ where: { id }, data: { status: "assigned" } });
    const ticket = toTicket(row);
    ticketEvents.emit("changed", ticket);
    return ticket;
  });
}

// QA 직원의 report_qa_result 판정을 반영한다. 통과면 사람 승인 없이 바로 완료 처리한다
// (기획서 단계에서 이미 사람이 승인했다는 전제 - 매 티켓마다 다시 승인받을 필요는 없다는
// 사용자 결정. QA가 없는 팀은 지금처럼 review에서 사람이 직접 승인해야 한다).
// 반려면 원래 담당 직원에게 돌려보내되(running) 3회 넘게 반려되면 사람에게 escalate한다
// (needs_approval - 사람이 승인하면 원래 담당자가 다시 시도, 거부하면 실패 처리).
export async function applyQaVerdict(
  id: string,
  pass: boolean,
  note: string
): Promise<{ ticket: Ticket; escalated: boolean }> {
  const result = await withTicketLock(id, async () => {
    const current = await prisma.ticket.findUniqueOrThrow({ where: { id } });
    if (current.status !== "qa_review") {
      throw new Error(`ticket ${id}는 qa_review 상태가 아닙니다 (현재: ${current.status})`);
    }
    if (pass) {
      const row = await prisma.ticket.update({ where: { id }, data: { status: "done", qaNote: null } });
      const t = toTicket(row);
      ticketEvents.emit("changed", t);
      return { ticket: t, escalated: false };
    }
    const cycles = current.qaCycles + 1;
    const nextStatus = cycles >= 3 ? "needs_approval" : "running";
    const row = await prisma.ticket.update({
      where: { id },
      data: { status: nextStatus, qaCycles: cycles, qaNote: note },
    });
    const t = toTicket(row);
    ticketEvents.emit("changed", t);
    return { ticket: t, escalated: nextStatus === "needs_approval" };
  });

  // transitionTicket("done")과 마찬가지로, 이 티켓이 blocked 티켓을 풀어주려던 것이었다면
  // 원래 티켓을 재개시킨다 - QA가 자동으로 done 처리하는 경로에서도 빠지면 안 된다.
  if (pass) await resumeParentIfBlocked(result.ticket);

  return result;
}

export async function recordHeartbeat(id: string): Promise<void> {
  await prisma.ticket.update({ where: { id }, data: { lastHeartbeatAt: new Date() } });
}

export async function updateMeta(
  id: string,
  meta: { worktreePath?: string; sessionId?: string }
): Promise<Ticket> {
  return withTicketLock(id, async () => {
    const row = await prisma.ticket.update({ where: { id }, data: meta });
    const ticket = toTicket(row);
    ticketEvents.emit("changed", ticket);
    return ticket;
  });
}
