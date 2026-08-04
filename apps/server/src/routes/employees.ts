import type { FastifyInstance } from "fastify";
import {
  createEmployee,
  deleteEmployee,
  EmployeeRenameBlockedError,
  getEmployee,
  listEmployees,
  updateEmployee,
} from "../employees/store.js";

interface EmployeeBody {
  teamId: string;
  name: string;
  driver: string;
  model?: string;
  taskDescription: string;
  // 담당 프로젝트(팀에 등록된 프로젝트 중 선택). 비우면 팀의 모든 프로젝트를 담당한다.
  projects?: string[];
  allowedTools?: string[];
  requireApproval?: string[];
}

const DEFAULT_ALLOWED_TOOLS = ["Read", "Edit", "Write", "Bash", "Grep", "Glob"];
const DEFAULT_REQUIRE_APPROVAL = ["git push", "rm"];
const VALID_DRIVERS = ["claude", "antigravity", "codex"];

export function registerEmployeeRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { teamId?: string } }>("/api/employees", async (req) => {
    return listEmployees(req.query.teamId);
  });

  app.get<{ Params: { id: string } }>("/api/employees/:id", async (req, reply) => {
    const employee = await getEmployee(req.params.id);
    if (!employee) return reply.code(404).send({ error: "not found" });
    return employee;
  });

  app.post<{ Body: EmployeeBody }>("/api/employees", async (req, reply) => {
    const { teamId, name, driver, model, taskDescription, projects, allowedTools, requireApproval } =
      req.body;
    if (!teamId || !name || !driver || !taskDescription) {
      return reply.code(400).send({ error: "teamId, name, driver, taskDescription are required" });
    }
    if (!VALID_DRIVERS.includes(driver)) {
      return reply.code(400).send({ error: `driver must be one of ${VALID_DRIVERS.join(", ")}` });
    }
    try {
      return await createEmployee({
        teamId,
        name,
        driver,
        model,
        taskDescription,
        projects: projects ?? [],
        allowedTools: allowedTools?.length ? allowedTools : DEFAULT_ALLOWED_TOOLS,
        requireApproval: requireApproval ?? DEFAULT_REQUIRE_APPROVAL,
      });
    } catch (err) {
      // 이름은 팀 안에서만 유일하다 - 다른 팀에 같은 이름이 있는 건 정상이므로 메시지에 명시한다.
      return reply
        .code(409)
        .send({ error: `이 팀에 이미 "${name}" 직원이 있습니다 (다른 팀에는 같은 이름을 쓸 수 있습니다)` });
    }
  });

  app.put<{ Params: { id: string }; Body: Partial<EmployeeBody> }>(
    "/api/employees/:id",
    async (req, reply) => {
      const existing = await getEmployee(req.params.id);
      if (!existing) return reply.code(404).send({ error: "not found" });
      if (req.body.driver && !VALID_DRIVERS.includes(req.body.driver)) {
        return reply.code(400).send({ error: `driver must be one of ${VALID_DRIVERS.join(", ")}` });
      }
      try {
        return await updateEmployee(req.params.id, req.body);
      } catch (err) {
        // 진행 중인 티켓이 있어 이름 변경이 막힌 경우 - 원인이 다르므로 메시지도 따로 준다.
        if (err instanceof EmployeeRenameBlockedError) {
          return reply.code(409).send({ error: err.message });
        }
        // 그 외(주로 이름 변경이 같은 팀의 기존 직원과 부딪히는 unique 제약 위반).
        return reply
          .code(409)
          .send({ error: `이 팀에 이미 "${req.body.name}" 직원이 있습니다 (다른 팀에는 같은 이름을 쓸 수 있습니다)` });
      }
    }
  );

  app.delete<{ Params: { id: string } }>("/api/employees/:id", async (req, reply) => {
    const existing = await getEmployee(req.params.id);
    if (!existing) return reply.code(404).send({ error: "not found" });
    await deleteEmployee(req.params.id);
    return { ok: true };
  });
}
