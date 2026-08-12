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
import { registerPlanningDocRoutes } from "./routes/planning-docs.js";
import { registerMemoryRoutes } from "./routes/memory.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerConsultRoutes } from "./routes/consult.js";
import { registerInfraBrowserRoutes } from "./routes/infra-browser.js";
import { releaseDueTicketRetries } from "./tickets/store.js";
import { ensureDefaultTeamAssigned } from "./teams/store.js";
import { migrateLegacyGeminiDriver } from "./employees/store.js";
import { registerUiWs } from "./ws/ui.js";
import { registerRunnerWs } from "./ws/runner.js";

const PORT = Number(process.env.SERVER_PORT ?? 8080);

// 새로 만든 DB(아직 `prisma db push`를 한 번도 안 돌린 상태)에서는 Team 테이블 자체가 없어서
// 이 호출이 실패한다. 여기서 기다리며 서버 시작(app.listen) 자체를 막아버리면 /health가
// 영영 응답을 안 해서 `pnpm start`의 헬스체크가 통째로 타임아웃난다 - 실제로 겪은 버그.
// app.listen 이후 백그라운드에서 스키마가 생길 때까지 재시도하도록 분리한다.
async function ensureDefaultTeamAssignedWithRetry(app: import("fastify").FastifyInstance) {
  const RETRY_DELAY_MS = 3000;
  for (;;) {
    try {
      await ensureDefaultTeamAssigned();
      // 같은 "부팅 시 자기치유" 성격이라 여기에 묶는다 - DB가 준비된 뒤에만 의미가 있다.
      await migrateLegacyGeminiDriver();
      return;
    } catch (err) {
      app.log.warn(
        { err },
        "ensureDefaultTeamAssigned 실패 (DB 스키마가 아직 없을 수 있음) - 잠시 후 재시도합니다"
      );
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }
}

async function main() {
  // 기본 1MB로는 채팅 이미지 첨부(base64)가 바로 걸린다 - 여유 있게 늘려둔다.
  const app = Fastify({ logger: true, bodyLimit: 25 * 1024 * 1024 });

  await app.register(websocketPlugin);

  registerHealthRoute(app);
  registerTicketRoutes(app);
  registerQuestionRoutes(app);
  registerChatRoutes(app);
  registerAgentRoutes(app);
  registerEmployeeRoutes(app);
  registerPeerMessageRoutes(app);
  registerDriverRoutes(app);
  registerTeamRoutes(app);
  registerPlanningDocRoutes(app);
  registerMemoryRoutes(app);
  registerProjectRoutes(app);
  registerConsultRoutes(app);
  registerInfraBrowserRoutes(app);
  registerUiWs(app);
  registerRunnerWs(app);

  await app.listen({ port: PORT, host: "0.0.0.0" });

  const retryTimer = setInterval(() => {
    releaseDueTicketRetries().catch((err) => app.log.error(err, "scheduled ticket retry failed"));
  }, 15_000);
  retryTimer.unref();
  releaseDueTicketRetries().catch((err) => app.log.error(err, "initial scheduled ticket retry failed"));

  // 팀 기능 추가 전부터 있던 직원/티켓(teamId가 비어있음)을 "기본 팀"으로 채워 넣는다.
  // 매번 불러도 안전하다 (이미 teamId가 있으면 대상이 없어 아무 일도 안 함).
  ensureDefaultTeamAssignedWithRetry(app).catch((err) => app.log.error(err));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
