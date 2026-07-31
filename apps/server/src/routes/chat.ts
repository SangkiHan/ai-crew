import type { FastifyInstance } from "fastify";
import type { ChatImage } from "@ai-crew/shared";
import {
  endActiveSession,
  getSessionMessages,
  listActiveChatMessages,
  listChatSessions,
  saveChatMessage,
} from "../chat/store.js";
import { requestEndSession, requestManagerInvocation } from "../ws/runner.js";

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
      // 새로고침/재접속해도 대화가 이어져 보이도록 영구 저장한다. 표시 텍스트는 웹 UI가 보여주는
      // 것과 똑같이(기획 모드면 "[기획] " 접두어) 저장한다 - 응답은 manager_result 도착 시 저장.
      const displayText = mode === "planning" ? `[기획] ${message}` : message;
      saveChatMessage(teamId, "user", displayText).catch((err) => req.log.error(err, "사용자 메시지 저장 실패"));
      return { requestId: result.requestId };
    }
  );

  // 지금 진행 중인(아직 "세션 종료" 안 누른) 대화만 반환한다 - 화면에 표시할 기본 기록.
  app.get<{ Querystring: { teamId: string } }>("/api/chat/messages", async (req, reply) => {
    const { teamId } = req.query;
    if (!teamId) return reply.code(400).send({ error: "teamId is required" });
    return listActiveChatMessages(teamId);
  });

  // 지난 세션 목록 (종료된 것 + 진행 중인 것 포함, 최신순) - "지난 대화" 패널에서 쓴다.
  app.get<{ Querystring: { teamId: string } }>("/api/chat/sessions", async (req, reply) => {
    const { teamId } = req.query;
    if (!teamId) return reply.code(400).send({ error: "teamId is required" });
    return listChatSessions(teamId);
  });

  app.get<{ Params: { id: string } }>("/api/chat/sessions/:id/messages", async (req) => {
    return getSessionMessages(req.params.id);
  });

  // "세션 종료" 버튼 전용 - 러너에 저장된 --resume 대상 세션 id를 지워서 팀장의 AI 기억을
  // 리셋하고, 지금 진행 중인 대화는 요약 없이 그대로 벡터 메모리에 남긴 뒤(search_history로
  // 나중에 참고 가능) 종료 처리한다. 지난 대화 자체는 지우지 않고 "지난 세션"으로 남는다.
  app.post<{ Params: { id: string } }>("/api/teams/:id/end-session", async (req, reply) => {
    const result = await requestEndSession(req.params.id);
    if (!result.success) return reply.code(500).send({ error: result.error ?? "알 수 없는 오류" });
    await endActiveSession(req.params.id);
    return { ok: true };
  });
}
