import { PrismaClient } from "@prisma/client";
import { EventEmitter } from "node:events";
import type { PlanningDoc, PlanningDocStatus } from "@ai-crew/shared";

const prisma = new PrismaClient();

export const planningDocEvents = new EventEmitter();

function toPlanningDoc(row: {
  id: string;
  teamId: string;
  employeeName: string;
  request: string;
  content: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): PlanningDoc {
  return {
    id: row.id,
    teamId: row.teamId,
    employeeName: row.employeeName,
    request: row.request,
    content: row.content,
    status: row.status as PlanningDocStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listPlanningDocs(teamId?: string): Promise<PlanningDoc[]> {
  const rows = await prisma.planningDoc.findMany({
    where: teamId ? { teamId } : undefined,
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toPlanningDoc);
}

export async function getPlanningDoc(id: string): Promise<PlanningDoc | null> {
  const row = await prisma.planningDoc.findUnique({ where: { id } });
  return row ? toPlanningDoc(row) : null;
}

export async function createPlanningDoc(input: {
  teamId: string;
  employeeName: string;
  request: string;
}): Promise<PlanningDoc> {
  const row = await prisma.planningDoc.create({ data: { ...input, status: "drafting" } });
  const doc = toPlanningDoc(row);
  planningDocEvents.emit("changed", doc);
  return doc;
}

// 러너가 기획서 작성을 마치면 호출된다. 실패해도 review로 - 사람이 내용(에러 메시지)을 보고
// 판단할 수 있게 한다. 완전히 비어있는 결과만 drafting으로 남겨 재시도 여지를 준다.
export async function updatePlanningDocResult(
  id: string,
  success: boolean,
  content: string
): Promise<PlanningDoc | null> {
  const row = await prisma.planningDoc.update({
    where: { id },
    data: { status: success ? "review" : "drafting", content },
  });
  const doc = toPlanningDoc(row);
  planningDocEvents.emit("changed", doc);
  return doc;
}

export async function setPlanningDocStatus(
  id: string,
  status: Extract<PlanningDocStatus, "approved" | "rejected">
): Promise<PlanningDoc> {
  const row = await prisma.planningDoc.update({ where: { id }, data: { status } });
  const doc = toPlanningDoc(row);
  planningDocEvents.emit("changed", doc);
  return doc;
}
