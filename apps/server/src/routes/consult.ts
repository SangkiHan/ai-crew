import type { FastifyInstance } from "fastify";
import { getEmployeeByName } from "../employees/store.js";
import { requestConsultEmployee } from "../ws/runner.js";

interface ConsultBody {
  teamId?: string;
  employeeName: string;
  project: string;
  question: string;
  fromEmployeeName?: string;
}

export function registerConsultRoutes(app: FastifyInstance) {
  // 기획자/직원의 ask_employee MCP 툴이 호출하는 경로. create_ticket과 같은 이유로 teamId를 받아
  // "다른 팀 직원에게는 못 물어본다"를 서버에서 강제한다.
  app.post<{ Body: ConsultBody }>("/api/consult", async (req, reply) => {
    const { teamId, employeeName, project, question, fromEmployeeName } = req.body;
    if (!employeeName || !project || !question) {
      return reply.code(400).send({ error: "employeeName, project, question are required" });
    }
    const employee = await getEmployeeByName(employeeName);
    if (!employee) {
      return reply.code(400).send({ error: `"${employeeName}" 직원을 찾을 수 없습니다` });
    }
    if (teamId && employee.teamId !== teamId) {
      return reply.code(403).send({ error: `"${employeeName}"은(는) 이 팀 소속이 아닙니다` });
    }
    const result = await requestConsultEmployee(employeeName, project, question, fromEmployeeName);
    if (!result.success) return reply.code(500).send({ error: result.error ?? "알 수 없는 오류" });
    return { answer: result.answer };
  });
}
