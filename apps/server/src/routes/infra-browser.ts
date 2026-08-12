import type { FastifyInstance } from "fastify";
import { requestLaunchInfraBrowser } from "../ws/runner.js";

// 웹 UI의 "인프라 크롬" 버튼용. INFRA_BROWSER_ENABLED 여부와 무관하게 항상 동작한다 - 이건
// 그냥 호스트에서 크롬을 하나 띄우는 것뿐이라, 팀장이 실제로 그 크롬에 붙는 기능(러너의
// INFRA_BROWSER_ENABLED)을 켜기 전에 미리 로그인/설정해두는 용도로도 쓸 수 있어야 한다.
export function registerInfraBrowserRoutes(app: FastifyInstance) {
  app.post("/api/infra-browser/launch", async () => {
    return requestLaunchInfraBrowser();
  });
}
