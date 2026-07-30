import Fastify from "fastify";
import websocketPlugin from "@fastify/websocket";
import { registerHealthRoute } from "./routes/health.js";
import { registerTicketRoutes } from "./routes/tickets.js";
import { registerQuestionRoutes } from "./routes/questions.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerAgentRoutes } from "./routes/agents.js";
import { registerUiWs } from "./ws/ui.js";
import { registerRunnerWs } from "./ws/runner.js";

const PORT = Number(process.env.SERVER_PORT ?? 8080);

async function main() {
  const app = Fastify({ logger: true });

  await app.register(websocketPlugin);

  registerHealthRoute(app);
  registerTicketRoutes(app);
  registerQuestionRoutes(app);
  registerChatRoutes(app);
  registerAgentRoutes(app);
  registerUiWs(app);
  registerRunnerWs(app);

  await app.listen({ port: PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
