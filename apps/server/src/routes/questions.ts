import type { FastifyInstance } from "fastify";
import { answerQuestion, createQuestion, getQuestion, listQuestions } from "../questions/store.js";

export function registerQuestionRoutes(app: FastifyInstance) {
  app.post<{ Body: { text: string } }>("/questions", async (req, reply) => {
    const { text } = req.body;
    if (!text) return reply.code(400).send({ error: "text is required" });
    return createQuestion(text);
  });

  app.get<{ Querystring: { status?: string } }>("/questions", async (req) => {
    return listQuestions(req.query.status);
  });

  app.get<{ Params: { id: string } }>("/questions/:id", async (req, reply) => {
    const question = await getQuestion(req.params.id);
    if (!question) return reply.code(404).send({ error: "not found" });
    return question;
  });

  app.post<{ Params: { id: string }; Body: { answer: string } }>(
    "/questions/:id/answer",
    async (req, reply) => {
      if (!req.body.answer) return reply.code(400).send({ error: "answer is required" });
      const existing = await getQuestion(req.params.id);
      if (!existing) return reply.code(404).send({ error: "not found" });
      return answerQuestion(req.params.id, req.body.answer);
    }
  );
}
