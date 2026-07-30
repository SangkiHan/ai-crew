import type { FastifyInstance } from "fastify";
import {
  answerPeerMessage,
  createPeerMessage,
  getPeerMessage,
  listPeerMessagesFor,
  listPeerMessagesFrom,
} from "../peer-messages/store.js";

export function registerPeerMessageRoutes(app: FastifyInstance) {
  app.post<{ Body: { fromName: string; toName: string; question: string } }>(
    "/api/peer-messages",
    async (req, reply) => {
      const { fromName, toName, question } = req.body;
      if (!fromName || !toName || !question) {
        return reply.code(400).send({ error: "fromName, toName, question are required" });
      }
      return createPeerMessage({ fromName, toName, question });
    }
  );

  // toName 생략하면 fromName 기준으로 자기가 물어본 것들을 조회 (답 왔는지 확인용)
  app.get<{ Querystring: { toName?: string; fromName?: string; status?: string } }>(
    "/api/peer-messages",
    async (req, reply) => {
      const { toName, fromName, status } = req.query;
      if (toName) return listPeerMessagesFor(toName, status);
      if (fromName) return listPeerMessagesFrom(fromName);
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
