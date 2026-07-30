import type { FastifyInstance } from "fastify";

// 1단계에서 러너가 job을 pull 해가는 채널로 채워질 자리 (localhost 전용, 외부 비노출)
export function registerRunnerWs(app: FastifyInstance) {
  app.get("/ws/runner", { websocket: true }, (socket) => {
    socket.on("message", () => {
      // placeholder: 1단계에서 RunnerToServerEvent 파싱 추가
    });
  });
}
