import type { FastifyInstance } from "fastify";
import { requestManagerInvocation } from "../ws/runner.js";

export function registerChatRoutes(app: FastifyInstance) {
  app.post<{ Body: { message: string } }>("/api/chat", async (req, reply) => {
    const { message } = req.body;
    if (!message?.trim()) return reply.code(400).send({ error: "message is required" });

    const result = requestManagerInvocation(message);
    if (!result.ok) {
      const status = result.reason === "busy" ? 409 : 503;
      const error =
        result.reason === "busy"
          ? "팀장이 이미 다른 요청을 처리 중입니다. 끝날 때까지 기다려주세요."
          : "러너가 연결되어 있지 않습니다. 호스트에서 러너를 실행해주세요.";
      return reply.code(status).send({ error });
    }
    return { requestId: result.requestId };
  });
}
