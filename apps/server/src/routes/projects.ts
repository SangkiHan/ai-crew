import type { FastifyInstance } from "fastify";
import { requestCreateProject } from "../ws/runner.js";

interface CreateProjectBody {
  name: string;
  gitUrl?: string;
  stack?: string;
}

export function registerProjectRoutes(app: FastifyInstance) {
  // 팀장의 create_project MCP 툴이 호출하는 경로. 실제 git clone/init은 호스트(러너)에서 한다.
  app.post<{ Body: CreateProjectBody }>("/api/projects", async (req, reply) => {
    const { name, gitUrl, stack } = req.body;
    if (!name?.trim()) return reply.code(400).send({ error: "name is required" });
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
      return reply.code(400).send({ error: "name은 영문/숫자/.-_ 만 사용할 수 있습니다 (경로 조작 방지)" });
    }
    const result = await requestCreateProject(name, gitUrl, stack);
    if (!result.success) return reply.code(500).send({ error: result.error ?? "알 수 없는 오류" });
    return result;
  });
}
