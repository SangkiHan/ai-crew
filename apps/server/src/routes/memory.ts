import type { FastifyInstance } from "fastify";
import { searchMemory } from "../memory/store.js";

export function registerMemoryRoutes(app: FastifyInstance) {
  // 팀장의 search_history MCP 툴이 호출하는 경로 - 완료된 티켓/기획서를 의미로 검색한다.
  app.get<{ Querystring: { teamId?: string; query?: string; limit?: string } }>(
    "/api/memory/search",
    async (req, reply) => {
      const { teamId, query, limit } = req.query;
      if (!teamId || !query) {
        return reply.code(400).send({ error: "teamId, query are required" });
      }
      return searchMemory(teamId, query, limit ? Number(limit) : undefined);
    }
  );
}
