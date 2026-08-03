import { PrismaClient } from "@prisma/client";
import type { PeerMessage } from "@ai-crew/shared";

const prisma = new PrismaClient();

function toPeerMessage(row: {
  id: string;
  teamId: string | null;
  fromName: string;
  toName: string;
  question: string;
  answer: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): PeerMessage {
  return {
    id: row.id,
    teamId: row.teamId,
    fromName: row.fromName,
    toName: row.toName,
    question: row.question,
    answer: row.answer,
    status: row.status as PeerMessage["status"],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createPeerMessage(input: {
  teamId: string;
  fromName: string;
  toName: string;
  question: string;
}): Promise<PeerMessage> {
  const row = await prisma.peerMessage.create({ data: input });
  return toPeerMessage(row);
}

// 직원 이름은 팀 안에서만 유일하므로 항상 팀과 함께 조회한다 - 그렇지 않으면 다른 팀의 동명이인이
// 남의 질문을 자기 것으로 받아 답하게 된다. teamId가 비어있는 옛 행(이 필드가 생기기 전에 오간
// 질문)은 팀 구분 없이 이름만으로 매칭해서 그대로 보이게 한다.
function teamScope(teamId: string) {
  return { OR: [{ teamId }, { teamId: null }] };
}

// 받는 직원이 자기 다음 티켓 실행을 시작할 때 미답변 질문을 확인하는 용도.
export async function listPeerMessagesFor(
  teamId: string,
  toName: string,
  status?: string
): Promise<PeerMessage[]> {
  const rows = await prisma.peerMessage.findMany({
    where: { toName, status, ...teamScope(teamId) },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toPeerMessage);
}

// 보낸 직원이 자기가 물어본 것 중 답이 왔는지 확인하는 용도.
export async function listPeerMessagesFrom(teamId: string, fromName: string): Promise<PeerMessage[]> {
  const rows = await prisma.peerMessage.findMany({
    where: { fromName, ...teamScope(teamId) },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toPeerMessage);
}

export async function answerPeerMessage(id: string, answer: string): Promise<PeerMessage> {
  const row = await prisma.peerMessage.update({ where: { id }, data: { answer, status: "answered" } });
  return toPeerMessage(row);
}

export async function getPeerMessage(id: string): Promise<PeerMessage | null> {
  const row = await prisma.peerMessage.findUnique({ where: { id } });
  return row ? toPeerMessage(row) : null;
}
