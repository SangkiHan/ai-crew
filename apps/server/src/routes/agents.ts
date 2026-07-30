import type { FastifyInstance } from "fastify";
import { listAllAgents } from "../agents/registry.js";

export function registerAgentRoutes(app: FastifyInstance) {
  app.get("/api/agents", async () => {
    return listAllAgents();
  });
}
