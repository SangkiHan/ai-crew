import { PrismaClient } from "@prisma/client";
import { EventEmitter } from "node:events";
import { canTransition, type Ticket, type TicketStatus } from "@ai-crew/shared";
import { saveMemory } from "../memory/store.js";

const prisma = new PrismaClient();

// 팀장이 나중에 search_history로 찾을 수 있도록 완료된 티켓을 임베딩해서 저장한다.
// 응답을 막지 않는다 (로컬 임베딩이라도 수백ms~1초 걸릴 수 있음). 사람이 UI에서 승인하는
// 경로(routes/tickets.ts)와 review 도달 시 자동으로 병합하는 경로(ws/runner.ts) 양쪽에서 쓴다.
export function saveTicketMemory(ticket: Ticket): void {
  saveMemory(ticket.teamId, "ticket", ticket.id, `${ticket.title}\n\n${ticket.spec}`).catch((err) =>
    console.error("티켓 임베딩 저장 실패:", err)
  );
}

export const ticketEvents = new EventEmitter();

const ORPHAN_STATUSES: TicketStatus[] = ["queued", "assigned", "running"];

// 직원 세션이 실제로 그 프로젝트 폴더에 파일을 쓰고 있는 상태들. 직원은 격리된 워크트리가 아니라
// 프로젝트 실제 폴더에 직접 작업하므로(runner/src/employees/prepare.ts), 같은 폴더에 이 상태의
// 티켓이 둘 이상 있으면 서로의 파일을 덮어쓴다 - 실제로 두 세션이 같은 트리를 동시에 고치다가
// 한쪽이 "커밋할 수 없다"며 blocked를 낸 사고가 있었다. review/blocked/needs_approval/done/failed는
// 세션이 이미 끝난 상태라 폴더를 잡고 있지 않으므로 여기 포함하지 않는다.
const PROJECT_BUSY_STATUSES: TicketStatus[] = ["assigned", "running", "qa_review"];

// 프로젝트 문자열이 절대경로일 수도, 이름만일 수도 있어서(팀장이 둘 다 넘길 수 있다) 마지막
// 경로 세그먼트를 소문자로 비교한다. 서버는 리눅스 컨테이너라 node:path가 윈도우 "\"를 못
// 알아보므로 직접 자른다. routes/tickets.ts의 등록 프로젝트 보정도 같은 규칙을 쓴다.
export function projectKey(project: string): string {
  const parts = project.split(/[\\/]/).filter(Boolean);
  return (parts[parts.length - 1] ?? project).toLowerCase();
}

// 이만큼 아무 소식이 없으면 그 세션은 죽은 것으로 보고 폴더를 놓은 것으로 취급한다. 세션이
// 크래시하거나 러너가 강제 종료되면 티켓이 running인 채로 영영 남는데(지금은 이 상태를 정리하는
// 장치가 없다), 그걸 살아있다고 믿으면 그 프로젝트에 다시는 티켓을 못 내보낸다. 직원이 긴 빌드나
// 테스트를 도는 동안에도 하트비트 간격이 몇 분씩 벌어질 수 있어 넉넉하게 잡았다.
const STALE_AFTER_MS = 15 * 60 * 1000;

// 이 프로젝트 폴더를 지금 잡고 있는 티켓 (있으면 새 티켓을 내보내면 안 된다).
export async function findActiveTicketForProject(
  project: string,
  excludeTicketId?: string
): Promise<Ticket | null> {
  const rows = await prisma.ticket.findMany({
    where: { status: { in: PROJECT_BUSY_STATUSES } },
    orderBy: { createdAt: "asc" },
  });
  const key = projectKey(project);
  const cutoff = Date.now() - STALE_AFTER_MS;
  const match = rows.find((r) => {
    if (r.id === excludeTicketId || projectKey(r.project) !== key) return false;
    // 하트비트가 아직 없는 티켓(막 assigned된 직후)은 updatedAt을 살아있다는 신호로 본다.
    const lastSignOfLife = Math.max(r.lastHeartbeatAt?.getTime() ?? 0, r.updatedAt.getTime());
    if (lastSignOfLife < cutoff) {
      console.warn(
        `[dispatch] 티켓 ${r.id}(${r.status})가 ${Math.round((Date.now() - lastSignOfLife) / 60000)}분째 ` +
          `응답이 없어 죽은 세션으로 보고 ${r.project} 점유를 해제합니다.`
      );
      return false;
    }
    return true;
  });
  return match ? toTicket(match) : null;
}

// 그 폴더가 비었을 때 다음으로 내보낼 티켓 (먼저 만들어진 것부터).
export async function findNextQueuedForProject(project: string): Promise<Ticket | null> {
  const rows = await prisma.ticket.findMany({
    where: { status: "queued" },
    orderBy: { createdAt: "asc" },
  });
  const key = projectKey(project);
  const match = rows.find((r) => projectKey(r.project) === key);
  return match ? toTicket(match) : null;
}

export function isProjectBusyStatus(status: TicketStatus): boolean {
  return PROJECT_BUSY_STATUSES.includes(status);
}

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
  branch: string | null;
  baseSha: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastHeartbeatAt: Date | null;
  qaCycles: number;
  qaNote: string | null;
  resultText: string | null;
  diffSummary: string | null;
  retryAt: Date | null;
  retryReason: string | null;
  retryCount: number;
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
    branch: row.branch,
    baseSha: row.baseSha,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastHeartbeatAt: row.lastHeartbeatAt ? row.lastHeartbeatAt.toISOString() : null,
    qaCycles: row.qaCycles,
    qaNote: row.qaNote,
    resultText: row.resultText,
    diffSummary: row.diffSummary,
    retryAt: row.retryAt ? row.retryAt.toISOString() : null,
    retryReason: row.retryReason,
    retryCount: row.retryCount,
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

// 실패한 실행을 같은 티켓으로 다시 시작한다. 이전 실행의 런타임 결과를 남겨두면 새 실행이
// 시작되기 전까지 실패 정보가 최신 결과처럼 보이므로 실행 메타데이터와 함께 비운다.
export async function retryFailedTicket(id: string): Promise<Ticket> {
  return withTicketLock(id, async () => {
    const current = await prisma.ticket.findUniqueOrThrow({ where: { id } });
    if (current.status !== "failed") {
      throw new Error(`failed 상태의 티켓만 다시 실행할 수 있습니다 (현재: ${current.status})`);
    }
    const row = await prisma.ticket.update({
      where: { id },
      data: {
        status: "queued",
        sessionId: null,
        branch: null,
        baseSha: null,
        lastHeartbeatAt: null,
        qaCycles: 0,
        qaNote: null,
        resultText: null,
        diffSummary: null,
        retryAt: null,
        retryReason: null,
      },
    });
    const ticket = toTicket(row);
    ticketEvents.emit("changed", ticket);
    return ticket;
  });
}

export async function scheduleTicketRetry(id: string, retryAt: Date, reason: string): Promise<Ticket> {
  return withTicketLock(id, async () => {
    const current = await prisma.ticket.findUniqueOrThrow({ where: { id } });
    if (current.status !== "failed") {
      throw new Error(`failed 상태의 티켓만 재실행 예약할 수 있습니다 (현재: ${current.status})`);
    }
    const row = await prisma.ticket.update({
      where: { id },
      data: { retryAt, retryReason: reason, retryCount: { increment: 1 } },
    });
    const ticket = toTicket(row);
    ticketEvents.emit("changed", ticket);
    return ticket;
  });
}

export async function releaseDueTicketRetries(): Promise<void> {
  const due = await prisma.ticket.findMany({
    where: { status: "failed", retryAt: { lte: new Date() } },
    select: { id: true },
  });
  for (const { id } of due) {
    await withTicketLock(id, async () => {
      const current = await prisma.ticket.findUnique({ where: { id } });
      if (!current || current.status !== "failed" || !current.retryAt || current.retryAt > new Date()) return;
      const row = await prisma.ticket.update({
        where: { id },
        data: {
          status: "queued",
          retryAt: null,
          retryReason: null,
          sessionId: null,
          branch: null,
          baseSha: null,
          lastHeartbeatAt: null,
          qaCycles: 0,
          qaNote: null,
          resultText: null,
          diffSummary: null,
        },
      });
      ticketEvents.emit("changed", toTicket(row));
    });
  }
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
  meta: { branch?: string; baseSha?: string; sessionId?: string; resultText?: string; diffSummary?: string }
): Promise<Ticket> {
  return withTicketLock(id, async () => {
    const row = await prisma.ticket.update({ where: { id }, data: meta });
    const ticket = toTicket(row);
    ticketEvents.emit("changed", ticket);
    return ticket;
  });
}
