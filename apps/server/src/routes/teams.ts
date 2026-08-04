import type { FastifyInstance } from "fastify";
import { isKnownDriverModel, type Driver } from "@ai-crew/shared";
import {
  countEmployeesInTeam,
  createTeam,
  deleteTeam,
  getTeam,
  listTeams,
  updateTeamManagerConfig,
  updateTeamProjects,
} from "../teams/store.js";
import { pruneEmployeeProjects } from "../employees/store.js";

// 팀장이 직접 코드를 고치지 않고(delegate-only) 세션이 끝나면 사라지므로 mock 드라이버를
// 골라줄 이유가 없다 - 직원 드라이버 검증(routes/employees.ts VALID_DRIVERS)과 같은 값 집합.
const VALID_MANAGER_DRIVERS: Driver[] = ["claude", "antigravity", "codex"];

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

  // 팀장을 실행할 CLI와 모델을 함께 바꾼다. driver를 바꾸면서 model을 이전 드라이버 기준 값
  // 그대로 두면 새 드라이버에서 무의미하거나 유효하지 않은 값이 될 수 있어 - 둘을 한 요청으로
  // 묶어 항상 같이 갱신한다(웹 UI가 드라이버 버튼을 누르는 즉시 model:null로 함께 보낸다).
  // model이 null/생략이면 agents/manager.md 기본값으로 되돌아간다. claude만 대화 이어가기를
  // 지원한다 - 다른 드라이버로 바꾸면 팀장이 매번 새 세션으로 시작한다(에러는 아니고 UI에 안내).
  app.put<{ Params: { id: string }; Body: { driver?: string; model: string | null } }>(
    "/api/teams/:id/manager-config",
    async (req, reply) => {
      const existing = await getTeam(req.params.id);
      if (!existing) return reply.code(404).send({ error: "not found" });
      const driver = (req.body.driver ?? existing.managerDriver) as Driver;
      if (!VALID_MANAGER_DRIVERS.includes(driver)) {
        return reply.code(400).send({ error: `driver must be one of ${VALID_MANAGER_DRIVERS.join(", ")}` });
      }
      const model = req.body.model?.trim() || null;
      if (model && !isKnownDriverModel(driver, model)) {
        return reply.code(400).send({ error: `"${driver}"에서 알 수 없는 모델입니다: ${model}` });
      }
      return updateTeamManagerConfig(req.params.id, driver, model);
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
