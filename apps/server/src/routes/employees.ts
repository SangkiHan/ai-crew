import type { FastifyInstance } from "fastify";
import {
  createEmployee,
  deleteEmployee,
  getEmployee,
  listEmployees,
  updateEmployee,
} from "../employees/store.js";

interface EmployeeBody {
  name: string;
  driver: string;
  model?: string;
  taskDescription: string;
  allowedTools?: string[];
  requireApproval?: string[];
}

const DEFAULT_ALLOWED_TOOLS = ["Read", "Edit", "Write", "Bash", "Grep", "Glob"];
const DEFAULT_REQUIRE_APPROVAL = ["git push", "rm"];
const VALID_DRIVERS = ["claude", "gemini", "codex"];

export function registerEmployeeRoutes(app: FastifyInstance) {
  app.get("/api/employees", async () => {
    return listEmployees();
  });

  app.get<{ Params: { id: string } }>("/api/employees/:id", async (req, reply) => {
    const employee = await getEmployee(req.params.id);
    if (!employee) return reply.code(404).send({ error: "not found" });
    return employee;
  });

  app.post<{ Body: EmployeeBody }>("/api/employees", async (req, reply) => {
    const { name, driver, model, taskDescription, allowedTools, requireApproval } = req.body;
    if (!name || !driver || !taskDescription) {
      return reply.code(400).send({ error: "name, driver, taskDescription are required" });
    }
    if (!VALID_DRIVERS.includes(driver)) {
      return reply.code(400).send({ error: `driver must be one of ${VALID_DRIVERS.join(", ")}` });
    }
    try {
      return await createEmployee({
        name,
        driver,
        model,
        taskDescription,
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
