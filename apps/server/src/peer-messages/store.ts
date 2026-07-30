import { PrismaClient } from "@prisma/client";
import type { PeerMessage } from "@ai-crew/shared";

const prisma = new PrismaClient();

function toPeerMessage(row: {
  id: string;
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
  fromName: string;
  toName: string;
  question: string;
}): Promise<PeerMessage> {
  const row = await prisma.peerMessage.create({ data: input });
  return toPeerMessage(row);
}

// 받는 직원이 자기 다음 티켓 실행을 시작할 때 미답변 질문을 확인하는 용도.
export async function listPeerMessagesFor(toName: string, status?: string): Promise<PeerMessage[]> {
  const rows = await prisma.peerMessage.findMany({
    where: { toName, status },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toPeerMessage);
}

// 보낸 직원이 자기가 물어본 것 중 답이 왔는지 확인하는 용도.
export async function listPeerMessagesFrom(fromName: string): Promise<PeerMessage[]> {
  const rows = await prisma.peerMessage.findMany({
    where: { fromName },
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
