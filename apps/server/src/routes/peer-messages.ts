import type { FastifyInstance } from "fastify";
import {
  answerPeerMessage,
  createPeerMessage,
  getPeerMessage,
  listPeerMessagesFor,
  listPeerMessagesFrom,
} from "../peer-messages/store.js";

export function registerPeerMessageRoutes(app: FastifyInstance) {
  // 직원 이름은 팀 안에서만 유일하므로 teamId가 필수다 - 없으면 다른 팀의 동명이인과 구분되지 않는다.
  app.post<{ Body: { teamId: string; fromName: string; toName: string; question: string } }>(
    "/api/peer-messages",
    async (req, reply) => {
      const { teamId, fromName, toName, question } = req.body;
      if (!teamId || !fromName || !toName || !question) {
        return reply.code(400).send({ error: "teamId, fromName, toName, question are required" });
      }
      return createPeerMessage({ teamId, fromName, toName, question });
    }
  );

  // toName 생략하면 fromName 기준으로 자기가 물어본 것들을 조회 (답 왔는지 확인용)
  app.get<{ Querystring: { teamId?: string; toName?: string; fromName?: string; status?: string } }>(
    "/api/peer-messages",
    async (req, reply) => {
      const { teamId, toName, fromName, status } = req.query;
      if (!teamId) return reply.code(400).send({ error: "teamId query param is required" });
      if (toName) return listPeerMessagesFor(teamId, toName, status);
      if (fromName) return listPeerMessagesFrom(teamId, fromName);
      return reply.code(400).send({ error: "toName or fromName query param is required" });
    }
  );

  app.post<{ Params: { id: string }; Body: { answer: string } }>(
    "/api/peer-messages/:id/answer",
    async (req, reply) => {
      if (!req.body.answer) return reply.code(400).send({ error: "answer is required" });
      const existing = await getPeerMessage(req.params.id);
      if (!existing) return reply.code(404).send({ error: "not found" });
      return answerPeerMessage(req.params.id, req.body.answer);
    }
  );
}
