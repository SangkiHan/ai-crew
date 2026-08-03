import type { FastifyInstance } from "fastify";
import {
  createPlanningDoc,
  getPlanningDoc,
  listPlanningDocs,
  markPlanningDocRevising,
  setPlanningDocStatus,
} from "../planning/store.js";
import { getEmployeeByName } from "../employees/store.js";
import { requestManagerInvocation, requestPlanningDocJob } from "../ws/runner.js";

interface CreatePlanningDocBody {
  teamId: string;
  employeeName: string;
  request: string;
}

export function registerPlanningDocRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { teamId?: string } }>("/api/planning-docs", async (req) => {
    return listPlanningDocs(req.query.teamId);
  });

  app.get<{ Params: { id: string } }>("/api/planning-docs/:id", async (req, reply) => {
    const doc = await getPlanningDoc(req.params.id);
    if (!doc) return reply.code(404).send({ error: "not found" });
    return doc;
  });

  // 팀장의 create_planning_doc MCP 툴이 호출하는 경로.
  app.post<{ Body: CreatePlanningDocBody }>("/api/planning-docs", async (req, reply) => {
    const { teamId, employeeName, request } = req.body;
    if (!teamId || !employeeName || !request) {
      return reply.code(400).send({ error: "teamId, employeeName, request are required" });
    }
    // 팀 안에서만 찾는다 - 다른 팀의 동명이인에게 기획을 맡기지 않기 위해서다.
    const employee = await getEmployeeByName(teamId, employeeName);
    if (!employee) {
      return reply.code(400).send({ error: `이 팀에 "${employeeName}" 직원이 없습니다` });
    }
    const doc = await createPlanningDoc({ teamId, employeeName, request });
    requestPlanningDocJob(doc, request);
    return doc;
  });

  // 사람이 초안을 보고 수정 요청("이 부분 고쳐줘")을 남긴다 - 새로 쓰는 게 아니라 같은 기획자
  // 세션을 이어서(--resume) 초안을 다듬는다 (티키타카).
  app.post<{ Params: { id: string }; Body: { message: string } }>(
    "/api/planning-docs/:id/revise",
    async (req, reply) => {
      const doc = await getPlanningDoc(req.params.id);
      if (!doc) return reply.code(404).send({ error: "not found" });
      if (doc.status !== "review") {
        return reply.code(400).send({ error: `review 상태의 기획서만 수정 요청할 수 있습니다 (현재: ${doc.status})` });
      }
      if (!req.body.message?.trim()) return reply.code(400).send({ error: "message is required" });
      const updated = await markPlanningDocRevising(doc.id);
      requestPlanningDocJob(updated, req.body.message, doc.sessionId ?? undefined);
      return updated;
    }
  );

  // 사람이 기획서를 검토하고 승인 - 그 내용을 바탕으로 팀장에게 실제 개발 티켓 발행을 요청한다.
  app.post<{ Params: { id: string } }>("/api/planning-docs/:id/approve", async (req, reply) => {
    const doc = await getPlanningDoc(req.params.id);
    if (!doc) return reply.code(404).send({ error: "not found" });
    if (doc.status !== "review") {
      return reply.code(400).send({ error: `review 상태의 기획서만 승인할 수 있습니다 (현재: ${doc.status})` });
    }
    const updated = await setPlanningDocStatus(doc.id, "approved");
    const message =
      `다음 기획서가 사용자 승인을 받았습니다. 이 내용에 따라 실제 개발 작업을 티켓으로 나누어 ` +
      `적합한 직원들에게 위임하세요 (list_employees로 다시 확인하고, 이 기획을 작성한 "${doc.employeeName}" ` +
      `본인에게 개발까지 맡길 필요는 없습니다 - 담당 업무가 맞는 다른 직원에게 위임하세요).\n\n` +
      `## 원래 요청\n${doc.request}\n\n## 승인된 기획서\n${updated.content ?? "(내용 없음)"}`;
    const result = requestManagerInvocation(doc.teamId, message);
    return { doc: updated, managerInvocation: result };
  });

  app.post<{ Params: { id: string } }>("/api/planning-docs/:id/reject", async (req, reply) => {
    const doc = await getPlanningDoc(req.params.id);
    if (!doc) return reply.code(404).send({ error: "not found" });
    if (doc.status !== "review") {
      return reply.code(400).send({ error: `review 상태의 기획서만 거부할 수 있습니다 (현재: ${doc.status})` });
    }
    return setPlanningDocStatus(doc.id, "rejected");
  });
}
