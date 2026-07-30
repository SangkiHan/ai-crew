import { PrismaClient } from "@prisma/client";
import type { Question } from "@ai-crew/shared";

const prisma = new PrismaClient();

function toQuestion(row: {
  id: string;
  text: string;
  status: string;
  answer: string | null;
  createdAt: Date;
  updatedAt: Date;
}): Question {
  return {
    id: row.id,
    text: row.text,
    status: row.status as Question["status"],
    answer: row.answer,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createQuestion(text: string): Promise<Question> {
  const row = await prisma.question.create({ data: { text } });
  return toQuestion(row);
}

export async function listQuestions(status?: string): Promise<Question[]> {
  const rows = await prisma.question.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toQuestion);
}

export async function answerQuestion(id: string, answer: string): Promise<Question> {
  const row = await prisma.question.update({
    where: { id },
    data: { answer, status: "answered" },
  });
  return toQuestion(row);
}

export async function getQuestion(id: string): Promise<Question | null> {
  const row = await prisma.question.findUnique({ where: { id } });
  return row ? toQuestion(row) : null;
}
