import { PrismaClient } from "@prisma/client";
import { embed } from "./embed.js";

const prisma = new PrismaClient();

export interface MemorySearchResult {
  sourceType: string;
  sourceId: string;
  content: string;
  distance: number;
}

// 완료된 티켓/기획서를 임베딩해서 저장한다 (upsert - 같은 소스가 다시 저장되면 갱신).
// 임베딩 계산이 (로컬 모델이라도) 수백ms~1초 걸릴 수 있어 호출부에서 fire-and-forget으로 쓴다.
export async function saveMemory(
  teamId: string,
  sourceType: "ticket" | "planning_doc",
  sourceId: string,
  content: string
): Promise<void> {
  const vector = await embed(content);
  const vectorLiteral = `[${vector.join(",")}]`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "MemoryEntry" (id, "teamId", "sourceType", "sourceId", content, embedding, "createdAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5::vector, now())
     ON CONFLICT ("sourceType", "sourceId")
     DO UPDATE SET content = $4, embedding = $5::vector, "teamId" = $1`,
    teamId,
    sourceType,
    sourceId,
    content,
    vectorLiteral
  );
}

// 그 팀의 과거 기록(티켓/기획서)을 의미로 검색한다. 정확한 id를 몰라도 "즐겨찾기 관련 작업"
// 처럼 자연어로 찾을 수 있다 - <=> 는 pgvector의 코사인 거리 연산자, 가까울수록(작을수록) 유사.
export async function searchMemory(teamId: string, query: string, limit = 5): Promise<MemorySearchResult[]> {
  const vector = await embed(query);
  const vectorLiteral = `[${vector.join(",")}]`;
  return prisma.$queryRawUnsafe<MemorySearchResult[]>(
    `SELECT "sourceType", "sourceId", content, embedding <=> $1::vector AS distance
     FROM "MemoryEntry"
     WHERE "teamId" = $2 AND embedding IS NOT NULL
     ORDER BY distance ASC
     LIMIT $3`,
    vectorLiteral,
    teamId,
    limit
  );
}
