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
}): Ticket {
  return {
    id: row.id,
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
  };
}

export async function createTicket(input: {
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

export async function listTickets(status?: string): Promise<Ticket[]> {
  const rows = await prisma.ticket.findMany({
    where: status ? { status } : undefined,
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

  // 이 티켓이 다른(blocked) 티켓을 풀어주려고 팀장이 만든 것이었다면, done이 되는 순간
  // 원래 막혀있던 티켓을 자동으로 재개시킨다 (blocked -> queued -> 러너가 다시 집어간다).
  if (to === "done" && ticket.parentTicketId) {
    const parent = await getTicket(ticket.parentTicketId);
    if (parent?.status === "blocked") {
      await transitionTicket(parent.id, "queued");
    }
  }

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
