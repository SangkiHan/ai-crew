import Fastify from "fastify";
import websocketPlugin from "@fastify/websocket";
import { registerHealthRoute } from "./routes/health.js";
import { registerTicketRoutes } from "./routes/tickets.js";
import { registerQuestionRoutes } from "./routes/questions.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerAgentRoutes } from "./routes/agents.js";
import { registerEmployeeRoutes } from "./routes/employees.js";
import { registerPeerMessageRoutes } from "./routes/peer-messages.js";
import { registerDriverRoutes } from "./routes/drivers.js";
import { registerTeamRoutes } from "./routes/teams.js";
import { ensureDefaultTeamAssigned } from "./teams/store.js";
import { registerUiWs } from "./ws/ui.js";
import { registerRunnerWs } from "./ws/runner.js";

const PORT = Number(process.env.SERVER_PORT ?? 8080);

async function main() {
  const app = Fastify({ logger: true });

  await app.register(websocketPlugin);

  // 팀 기능 추가 전부터 있던 직원/티켓(teamId가 비어있음)을 "기본 팀"으로 채워 넣는다.
  // 매번 불러도 안전하다 (이미 teamId가 있으면 대상이 없어 아무 일도 안 함).
  await ensureDefaultTeamAssigned();

  registerHealthRoute(app);
  registerTicketRoutes(app);
  registerQuestionRoutes(app);
  registerChatRoutes(app);
  registerAgentRoutes(app);
  registerEmployeeRoutes(app);
  registerPeerMessageRoutes(app);
  registerDriverRoutes(app);
  registerTeamRoutes(app);
  registerUiWs(app);
  registerRunnerWs(app);

  await app.listen({ port: PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
