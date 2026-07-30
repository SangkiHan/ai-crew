import { PrismaClient } from "@prisma/client";
import { EventEmitter } from "node:events";
import type { PlanningDoc, PlanningDocStatus } from "@ai-crew/shared";
import { saveMemory } from "../memory/store.js";

const prisma = new PrismaClient();

export const planningDocEvents = new EventEmitter();

function toPlanningDoc(row: {
  id: string;
  teamId: string;
  employeeName: string;
  request: string;
  content: string | null;
  status: string;
  sessionId: string | null;
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
    sessionId: row.sessionId,
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

// 러너가 기획서 작성(최초 또는 수정)을 마치면 호출된다. 실패해도 review로 - 사람이 내용(에러
// 메시지)을 보고 판단할 수 있게 한다. 완전히 비어있는 결과만 drafting으로 남겨 재시도 여지를 준다.
export async function updatePlanningDocResult(
  id: string,
  success: boolean,
  content: string,
  sessionId?: string
): Promise<PlanningDoc | null> {
  const row = await prisma.planningDoc.update({
    where: { id },
    data: { status: success ? "review" : "drafting", content, sessionId: sessionId ?? undefined },
  });
  const doc = toPlanningDoc(row);
  planningDocEvents.emit("changed", doc);
  return doc;
}

// 사람이 초안을 보고 "이 부분 고쳐줘" 같은 수정 요청을 남긴다 - 새로 쓰는 게 아니라 같은
// 기획자 세션을 이어서(--resume) 초안을 다듬는다. drafting으로 돌아갔다가 완료되면 다시 review.
export async function markPlanningDocRevising(id: string): Promise<PlanningDoc> {
  const row = await prisma.planningDoc.update({ where: { id }, data: { status: "drafting" } });
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

  // 검토 중 반려된 초안은 기억에 안 남긴다 - 사람이 최종 승인한 기획만 팀의 "결정된 사실"로
  // 취급해서 search_history로 찾을 수 있게 한다. 응답을 막지 않는다.
  if (status === "approved" && doc.content) {
    saveMemory(doc.teamId, "planning_doc", doc.id, `${doc.request}\n\n${doc.content}`).catch((err) =>
      console.error("기획서 임베딩 저장 실패:", err)
    );
  }

  return doc;
}
