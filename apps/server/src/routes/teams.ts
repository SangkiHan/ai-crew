import type { FastifyInstance } from "fastify";
import { isKnownDriverModel } from "@ai-crew/shared";
import {
  countEmployeesInTeam,
  createTeam,
  deleteTeam,
  getTeam,
  listTeams,
  updateTeamManagerModel,
  updateTeamProjects,
} from "../teams/store.js";
import { pruneEmployeeProjects } from "../employees/store.js";

export function registerTeamRoutes(app: FastifyInstance) {
  app.get("/api/teams", async () => {
    return listTeams();
  });

  app.post<{ Body: { name: string; projects?: string[] } }>("/api/teams", async (req, reply) => {
    const name = req.body.name?.trim();
    if (!name) return reply.code(400).send({ error: "name is required" });
    try {
      return await createTeam(name, req.body.projects);
    } catch {
      return reply.code(409).send({ error: `이름이 이미 존재합니다: ${name}` });
    }
  });

  // 팀이 담당하는 프로젝트 이름/절대경로 목록을 통째로 교체한다 (추가/삭제는 UI가 전체 목록을
  // 다시 보내는 방식으로 처리 - 목록이 작아서 부분 patch보다 이쪽이 단순하다).
  app.put<{ Params: { id: string }; Body: { projects: string[] } }>(
    "/api/teams/:id/projects",
    async (req, reply) => {
      const existing = await getTeam(req.params.id);
      if (!existing) return reply.code(404).send({ error: "not found" });
      if (!Array.isArray(req.body.projects)) {
        return reply.code(400).send({ error: "projects must be an array" });
      }
      const projects = req.body.projects.map((p) => p.trim()).filter(Boolean);
      const team = await updateTeamProjects(req.params.id, projects);
      // 목록에서 빠진 프로젝트를 담당하고 있던 직원이 있으면 그 직원의 담당에서도 걷어낸다.
      await pruneEmployeeProjects(req.params.id, projects);
      return team;
    }
  );

  // 팀장 세션의 모델을 바꾼다. model이 null/생략이면 agents/manager.md 기본값으로 되돌아간다.
  // 팀장은 항상 claude 드라이버라 직원의 DRIVER_MODEL_OPTIONS.claude와 같은 값 집합을 검증에 쓴다.
  app.put<{ Params: { id: string }; Body: { model: string | null } }>(
    "/api/teams/:id/manager-model",
    async (req, reply) => {
      const existing = await getTeam(req.params.id);
      if (!existing) return reply.code(404).send({ error: "not found" });
      const model = req.body.model?.trim() || null;
      if (model && !isKnownDriverModel("claude", model)) {
        return reply.code(400).send({ error: `알 수 없는 모델입니다: ${model}` });
      }
      return updateTeamManagerModel(req.params.id, model);
    }
  );

  // 직원이 남아있는 팀은 삭제를 막는다 - 실수로 팀을 지웠다가 그 직원들의 소속이 붕 뜨는 걸 방지.
  // 먼저 그 팀의 직원을 다른 팀으로 옮기거나 삭제해야 한다.
  app.delete<{ Params: { id: string } }>("/api/teams/:id", async (req, reply) => {
    const existing = await getTeam(req.params.id);
    if (!existing) return reply.code(404).send({ error: "not found" });
    const employeeCount = await countEmployeesInTeam(req.params.id);
    if (employeeCount > 0) {
      return reply.code(409).send({ error: `이 팀에 직원이 ${employeeCount}명 있습니다. 먼저 직원을 정리해주세요.` });
    }
    const teams = await listTeams();
    if (teams.length <= 1) {
      return reply.code(409).send({ error: "최소 1개의 팀은 남아있어야 합니다." });
    }
    await deleteTeam(req.params.id);
    return { ok: true };
  });
}
