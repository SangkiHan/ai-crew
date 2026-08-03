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
    if (!teamId || !employeeName || !project || !question) {
      return reply.code(400).send({ error: "teamId, employeeName, project, question are required" });
    }
    // 이름은 팀 안에서만 유일하므로 팀과 함께 찾는다 - 이것만으로 "다른 팀 직원에게는 못 물어본다"가
    // 자동으로 강제된다(예전에는 전역으로 찾고 나서 소속을 따로 확인했다).
    const employee = await getEmployeeByName(teamId, employeeName);
    if (!employee) {
      return reply.code(400).send({ error: `이 팀에 "${employeeName}" 직원이 없습니다` });
    }
    const result = await requestConsultEmployee(teamId, employeeName, project, question, fromEmployeeName);
    if (!result.success) return reply.code(500).send({ error: result.error ?? "알 수 없는 오류" });
    return { answer: result.answer };
  });
}
