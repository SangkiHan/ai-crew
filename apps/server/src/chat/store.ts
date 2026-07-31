import { PrismaClient } from "@prisma/client";
import { saveMemory } from "../memory/store.js";

const prisma = new PrismaClient();

export interface StoredChatMessage {
  id: string;
  teamId: string;
  sessionId: string;
  role: "user" | "manager";
  text: string;
  createdAt: string;
}

export interface ChatSessionSummary {
  id: string;
  teamId: string;
  startedAt: string;
  endedAt: string | null;
  messageCount: number;
}

function toChatMessage(row: {
  id: string;
  teamId: string;
  sessionId: string;
  role: string;
  text: string;
  createdAt: Date;
}): StoredChatMessage {
  return {
    id: row.id,
    teamId: row.teamId,
    sessionId: row.sessionId,
    role: row.role === "manager" ? "manager" : "user",
    text: row.text,
    createdAt: row.createdAt.toISOString(),
  };
}

// 그 팀의 "지금 진행 중인" 세션(endedAt이 비어있는 것)을 찾고, 없으면(첫 메시지거나 방금
// 세션 종료 직후) 새로 만든다. "세션 종료"를 누르기 전까지는 계속 같은 세션에 쌓인다.
async function getOrCreateActiveSession(teamId: string): Promise<{ id: string }> {
  const existing = await prisma.chatSession.findFirst({
    where: { teamId, endedAt: null },
    orderBy: { startedAt: "desc" },
  });
  if (existing) return existing;
  return prisma.chatSession.create({ data: { teamId } });
}

export async function saveChatMessage(
  teamId: string,
  role: "user" | "manager",
  text: string
): Promise<StoredChatMessage> {
  const session = await getOrCreateActiveSession(teamId);
  const row = await prisma.chatMessage.create({ data: { teamId, sessionId: session.id, role, text } });
  return toChatMessage(row);
}

// 화면에 표시할 "지금 진행 중인 대화"만 반환한다 - 지난 세션은 listChatSessions/getSessionMessages로.
export async function listActiveChatMessages(teamId: string): Promise<StoredChatMessage[]> {
  const session = await prisma.chatSession.findFirst({ where: { teamId, endedAt: null } });
  if (!session) return [];
  const rows = await prisma.chatMessage.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toChatMessage);
}

export async function listChatSessions(teamId: string): Promise<ChatSessionSummary[]> {
  const sessions = await prisma.chatSession.findMany({
    where: { teamId },
    orderBy: { startedAt: "desc" },
    include: { _count: { select: { messages: true } } },
  });
  return sessions.map((s) => ({
    id: s.id,
    teamId: s.teamId,
    startedAt: s.startedAt.toISOString(),
    endedAt: s.endedAt?.toISOString() ?? null,
    messageCount: s._count.messages,
  }));
}

export async function getSessionMessages(sessionId: string): Promise<StoredChatMessage[]> {
  const rows = await prisma.chatMessage.findMany({ where: { sessionId }, orderBy: { createdAt: "asc" } });
  return rows.map(toChatMessage);
}

// "세션 종료" 버튼 전용. 지금 진행 중인 세션을 끝내고, 그 대화 전체를 요약 없이 통째로
// 벡터 메모리에 저장한다(팀장의 search_history로 나중에 "예전에 뭐 했었지" 참고 가능) -
// 다음 메시지부터는 getOrCreateActiveSession이 자동으로 새 세션을 만든다.
export async function endActiveSession(teamId: string): Promise<void> {
  const session = await prisma.chatSession.findFirst({ where: { teamId, endedAt: null } });
  if (!session) return; // 이미 메시지가 하나도 없는 상태 - 끝낼 세션이 없음

  const messages = await prisma.chatMessage.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: "asc" },
  });
  await prisma.chatSession.update({ where: { id: session.id }, data: { endedAt: new Date() } });

  if (messages.length === 0) return; // 빈 세션은 메모리에 남길 내용이 없음
  const transcript = messages
    .map((m) => `${m.role === "user" ? "사용자" : "팀장"}: ${m.text}`)
    .join("\n\n");
  const dateLabel = session.startedAt.toISOString().slice(0, 10);
  await saveMemory(
    teamId,
    "chat_session",
    session.id,
    `${dateLabel}에 나눈 대화 (세션 종료됨)\n\n${transcript}`
  );
}
