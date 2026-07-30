import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { ServerToUiEvent } from "@ai-crew/shared";

const uiSockets = new Set<WebSocket>();

export function registerUiWs(app: FastifyInstance) {
  app.get("/ws/ui", { websocket: true }, (socket: WebSocket) => {
    uiSockets.add(socket);
    app.log.info("ui client connected");

    socket.on("close", () => {
      uiSockets.delete(socket);
    });
  });
}

export function broadcastToUi(event: ServerToUiEvent) {
  const payload = JSON.stringify(event);
  for (const socket of uiSockets) {
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }
}
