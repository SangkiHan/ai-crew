import type { FastifyInstance } from "fastify";
import { requestDriverStatus } from "../ws/runner.js";

// 직원 추가 폼에서 claude/gemini/codex CLI가 이 맥(러너)에 설치돼 있는지 보여주는 용도.
// 로그인(OAuth) 여부까지는 확인 안 한다 - 브라우저에서 대신 로그인해줄 방법이 없어서,
// 실제로 티켓을 돌려보고 실패 로그로 확인하는 수밖에 없다.
export function registerDriverRoutes(app: FastifyInstance) {
  app.get("/api/driver-status", async () => {
    return requestDriverStatus();
  });
}
