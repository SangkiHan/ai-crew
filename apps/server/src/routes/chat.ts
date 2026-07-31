import type { FastifyInstance } from "fastify";
import type { ChatImage } from "@ai-crew/shared";
import { requestManagerInvocation } from "../ws/runner.js";

// "기획" 모드로 보낸 메시지는 팀장에게 그대로 전달하지 않고, 코드 티켓 대신 기획서를 만들도록
// 지시를 앞에 붙인다 - 팀장의 create_planning_doc MCP 툴로 이어진다.
function buildPlanningMessage(message: string): string {
  return (
    `[기획 요청] 아래는 서비스 기획 요청입니다. 코드를 구현하는 티켓을 만들지 말고, ` +
    `list_employees에서 서비스 기획/PM 업무를 담당하는 직원을 찾아 create_planning_doc 툴로 ` +
    `위임하세요 (당신이 직접 기획서를 작성하지 마세요). 담당 직원이 없으면 어떤 담당 업무의 ` +
    `직원을 추가해야 하는지 사용자에게 안내하세요.\n\n### 요청 내용\n${message}`
  );
}

export function registerChatRoutes(app: FastifyInstance) {
  app.post<{ Body: { teamId: string; message: string; mode?: "chat" | "planning"; images?: ChatImage[] } }>(
    "/api/chat",
    async (req, reply) => {
      const { teamId, message, mode, images } = req.body;
      if (!teamId) return reply.code(400).send({ error: "teamId is required" });
      if (!message?.trim()) return reply.code(400).send({ error: "message is required" });

      const finalMessage = mode === "planning" ? buildPlanningMessage(message) : message;
      const result = requestManagerInvocation(teamId, finalMessage, images);
      if (!result.ok) {
        const status = result.reason === "busy" ? 409 : 503;
        const error =
          result.reason === "busy"
            ? "팀장이 이미 다른 요청을 처리 중입니다. 끝날 때까지 기다려주세요."
            : "러너가 연결되어 있지 않습니다. 호스트에서 러너를 실행해주세요.";
        return reply.code(status).send({ error });
      }
      return { requestId: result.requestId };
    }
  );
}
