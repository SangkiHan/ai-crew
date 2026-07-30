import { PrismaClient } from "@prisma/client";
import { EventEmitter } from "node:events";
import { canTransition, type Ticket, type TicketStatus } from "@ai-crew/shared";

const prisma = new PrismaClient();

export const ticketEvents = new EventEmitter();

const ORPHAN_STATUSES: TicketStatus[] = ["queued", "assigned", "running"];

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
  const current = await prisma.ticket.findUniqueOrThrow({ where: { id } });
  const from = current.status as TicketStatus;
  if (!canTransition(from, to)) {
    throw new Error(`invalid ticket transition ${from} -> ${to} (ticket ${id})`);
  }
  const row = await prisma.ticket.update({ where: { id }, data: { status: to } });
  const ticket = toTicket(row);
  ticketEvents.emit("changed", ticket);
  return ticket;
}

export async function recordHeartbeat(id: string): Promise<void> {
  await prisma.ticket.update({ where: { id }, data: { lastHeartbeatAt: new Date() } });
}
