import type { FastifyInstance } from "fastify";

// 1단계에서 UI 스트림(티켓 업데이트, 로그) 브로드캐스트로 채워질 자리
export function registerUiWs(app: FastifyInstance) {
  app.get("/ws/ui", { websocket: true }, (socket) => {
    socket.on("message", () => {
      // placeholder: 1단계에서 UiToServerEvent 파싱 추가
    });
  });
}
