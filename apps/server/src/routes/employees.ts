import type { FastifyInstance } from "fastify";
import {
  createEmployee,
  deleteEmployee,
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
const VALID_DRIVERS = ["claude", "gemini", "codex"];

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
      return reply.code(409).send({ error: `이름이 이미 존재합니다: ${name}` });
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
      return updateEmployee(req.params.id, req.body);
    }
  );

  app.delete<{ Params: { id: string } }>("/api/employees/:id", async (req, reply) => {
    const existing = await getEmployee(req.params.id);
    if (!existing) return reply.code(404).send({ error: "not found" });
    await deleteEmployee(req.params.id);
    return { ok: true };
  });
}
