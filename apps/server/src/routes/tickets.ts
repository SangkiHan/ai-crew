import type { FastifyInstance } from "fastify";
import {
  applyQaVerdict,
  createTicket,
  getTicket,
  listTickets,
  projectKey,
  saveTicketMemory,
  transitionTicket,
} from "../tickets/store.js";
import { getEmployeeByName } from "../employees/store.js";
import { getTeam } from "../teams/store.js";
import {
  notifyManagerOfTicketResult,
  pushToAnyRunner,
  requestManagerInvocation,
  requestTicketRevise,
} from "../ws/runner.js";
import { broadcastToUi } from "../ws/ui.js";

// 팀장이 "프로젝트 관리"에 등록된 절대경로 대신 이름만(또는 다른 표기로) 넘겨도, 등록된 목록
// 중 이름이 일치하는 게 있으면 그 절대경로로 강제 치환한다 - 팀장(LLM)이 매번 정확한 절대경로를
// 쓸 거라고 프롬프트로만 기대하지 않고, 서버에서 결정적으로 보정한다. 비교 규칙(projectKey)은
// 같은 폴더를 쓰는 티켓끼리의 동시 실행을 막는 쪽과 공유한다 - 두 곳이 어긋나면 안 된다.
function resolveRegisteredProject(project: string, registeredProjects: string[]): string {
  if (registeredProjects.includes(project)) return project;
  const requestedKey = projectKey(project);
  const match = registeredProjects.find((p) => projectKey(p) === requestedKey);
  return match ?? project;
}

interface CreateTicketBody {
  // 팀장의 MCP 툴(create_ticket)이 자기 TEAM_ID를 실어 보낸다 - "다른 팀 직원에게 티켓을
  // 만들 수 없다"를 서버에서 강제하기 위해서다. role로 찾은 직원의 실제 teamId를 최종값으로 쓴다.
  teamId?: string;
  role: string;
  project: string;
  title: string;
  spec: string;
  parentTicketId?: string;
}

export function registerTicketRoutes(app: FastifyInstance) {
  app.post<{ Body: CreateTicketBody }>("/api/tickets", async (req, reply) => {
    const { teamId, role, project, title, spec, parentTicketId } = req.body;
    if (!role || !project || !title || !spec) {
      return reply.code(400).send({ error: "role, project, title, spec are required" });
    }
    const employee = await getEmployeeByName(role);
    if (!employee) {
      return reply.code(400).send({ error: `"${role}" 직원을 찾을 수 없습니다` });
    }
    if (teamId && employee.teamId !== teamId) {
      return reply.code(403).send({ error: `"${role}"은(는) 이 팀 소속이 아닙니다` });
    }
    const team = await getTeam(employee.teamId);
    const resolvedProject = team ? resolveRegisteredProject(project, team.projects) : project;
    // 담당 프로젝트가 지정된 직원에게는 그 프로젝트의 티켓만 만들 수 있다. 비어있으면 (이 필드가
    // 생기기 전에 만들어진 직원 포함) 팀의 모든 프로젝트를 담당한다는 뜻이라 그냥 통과시킨다.
    // 반드시 resolveRegisteredProject로 정규화한 뒤에 비교한다 - 팀장이 절대경로 대신 이름만
    // 넘기는 정상 요청이 오탐으로 막히면 안 된다.
    if (employee.projects.length > 0 && !employee.projects.includes(resolvedProject)) {
      // 이 400은 MCP 툴 결과로 팀장(LLM)에게 그대로 돌아간다 - 메시지 자체가 복구 지시문이다.
      return reply.code(400).send({
        error:
          `"${role}"의 담당 프로젝트가 아닙니다 (요청: ${resolvedProject}). ` +
          `이 직원의 담당 프로젝트: ${employee.projects.join(", ")}. ` +
          `list_employees로 이 프로젝트를 담당하는 다른 직원을 찾아 위임하세요.`,
      });
    }
    // 티켓 push는 store의 ticketEvents("changed") 구독자(ws/runner.ts) 쪽 한 곳에서만 처리한다.
    // 여기서 별도로 pushToAnyRunner를 부르면 같은 티켓이 두 번 assign되는 버그가 생긴다.
    return createTicket({ teamId: employee.teamId, role, project: resolvedProject, title, spec, parentTicketId });
  });

  app.get<{ Querystring: { status?: string; teamId?: string } }>("/api/tickets", async (req) => {
    return listTickets(req.query.status, req.query.teamId);
  });

  app.get<{ Params: { id: string } }>("/api/tickets/:id", async (req, reply) => {
    const ticket = await getTicket(req.params.id);
    if (!ticket) return reply.code(404).send({ error: "not found" });
    return ticket;
  });

  // needs_approval -> running 전용 경로다 (QA가 3회 넘게 반려해서 사람에게 계속할지 물어본
  // 경우만 해당). review -> done은 이제 사람이 누를 필요 없이 자동으로 처리된다
  // (ws/runner.ts의 autoApproveTicket) - 직원은 프로젝트 실제 폴더에서 직접 커밋하므로 승인
  // 시점에 별도로 병합할 것도 없다. 그래도 이 엔드포인트 자체는 남겨둔다 - 러너가 잠깐
  // 끊겨서 review 티켓이 자동 처리를 못 받고 멈춰있는 것 같은 예외 상황의 수동 복구용이다.
  app.post<{ Params: { id: string } }>("/api/tickets/:id/approve", async (req, reply) => {
    const ticket = await getTicket(req.params.id);
    if (!ticket) return reply.code(404).send({ error: "not found" });
    const wasReview = ticket.status === "review";
    const to = wasReview ? "done" : ticket.status === "needs_approval" ? "running" : null;
    if (!to) return reply.code(400).send({ error: `cannot approve ticket in status ${ticket.status}` });
    const updated = await transitionTicket(ticket.id, to);
    if (wasReview) {
      saveTicketMemory(updated);
    } else {
      // needs_approval -> running: "queued"가 아니라서 store의 changed 리스너가 자동으로
      // 러너에 밀어주지 않는다 - 여기서 직접 밀어줘야 실제로 다시 실행된다.
      await pushToAnyRunner(updated.id);
    }
    return updated;
  });

  // 사람이 review 티켓을 보고 수정 요청("이 부분 고쳐줘")을 남긴다 - 프로젝트 실제 폴더에서
  // 담당 직원의 Claude Code 세션을 그대로 이어서(--resume) 수정사항만 반영한다 (기획서
  // 티키타카와 같은 패턴). 반영이 끝나면 다시 review로 돌아온다
  // (review -> running -> review는 이미 허용된 전이).
  app.post<{ Params: { id: string }; Body: { message: string } }>(
    "/api/tickets/:id/revise",
    async (req, reply) => {
      const ticket = await getTicket(req.params.id);
      if (!ticket) return reply.code(404).send({ error: "not found" });
      if (ticket.status !== "review") {
        return reply.code(400).send({ error: `review 상태의 티켓만 수정 요청할 수 있습니다 (현재: ${ticket.status})` });
      }
      if (!req.body.message?.trim()) return reply.code(400).send({ error: "message is required" });
      const updated = await transitionTicket(ticket.id, "running");
      requestTicketRevise(updated, req.body.message);
      return updated;
    }
  );

  // review/needs_approval 외에 blocked도 허용한다 - 사람이 보기에 더 이상 처리할 필요가 없는
  // (다른 방식으로 해결했다/취소한다) blocked 티켓을 웹에서 직접 종료할 방법이 없어서, 그 티켓의
  // 원래 담당 직원이 org chart에 "확인 필요"로 계속 남아있는 문제가 있었다. blocked -> failed는
  // 이미 허용된 전이(packages/shared/src/ticket.ts)라 상태 자체는 그대로 재사용한다.
  app.post<{ Params: { id: string } }>("/api/tickets/:id/reject", async (req, reply) => {
    const ticket = await getTicket(req.params.id);
    if (!ticket) return reply.code(404).send({ error: "not found" });
    if (ticket.status !== "review" && ticket.status !== "needs_approval" && ticket.status !== "blocked") {
      return reply.code(400).send({ error: `cannot reject ticket in status ${ticket.status}` });
    }
    return transitionTicket(ticket.id, "failed");
  });

  // QA 직원의 report_qa_result MCP 툴이 호출하는 경로. 판정(통과/반려)에 따른 다음 상태 전이와
  // 재발행/escalation은 전부 tickets/store.ts의 applyQaVerdict가 결정한다.
  app.post<{ Params: { id: string }; Body: { pass: boolean; note?: string } }>(
    "/api/tickets/:id/qa-result",
    async (req, reply) => {
      const existing = await getTicket(req.params.id);
      if (!existing) return reply.code(404).send({ error: "not found" });
      if (existing.status !== "qa_review") {
        return reply.code(400).send({ error: `ticket is not in qa_review (current: ${existing.status})` });
      }
      const { pass, note } = req.body;
      const { ticket, escalated } = await applyQaVerdict(req.params.id, pass, note ?? "");
      broadcastToUi({
        type: "log_line",
        ticketId: ticket.id,
        line: pass
          ? "[QA] 통과 - 사람 승인 없이 바로 완료 처리합니다."
          : escalated
            ? `[QA] ${ticket.qaCycles}회 연속 반려됨 - 사람 확인이 필요합니다: ${note ?? ""}`
            : `[QA] 반려 (${ticket.qaCycles}/3) - 담당 직원에게 다시 보냅니다: ${note ?? ""}`,
        ts: new Date().toISOString(),
      });
      if (pass) {
        saveTicketMemory(ticket);
        // QA 통과 -> done도 직원이 review에 도달했을 때와 마찬가지로 "이미 끝난 일" 보고를
        // 팀장에게 보내야 한다 - 이 경로(QA 있는 팀)에서는 여태 이 알림이 빠져있어서
        // 사용자가 작업 완료를 전혀 통보받지 못하는 사고가 있었다.
        notifyManagerOfTicketResult(ticket, "done");
      } else if (escalated) {
        notifyManagerOfTicketResult(ticket, "needs_approval");
      } else {
        await pushToAnyRunner(ticket.id);
      }
      return ticket;
    }
  );

  // 직원이 report_blocked MCP 툴로 호출하는 경로. blocked로 전이하고, 사유를 로그로 남기고,
  // 팀장을 자동으로 깨워서 조치하게 한다 (팀장이 이미 바쁘면 사람이 UI에서 보고 직접 채팅해야 함).
  app.post<{ Params: { id: string }; Body: { reason: string } }>(
    "/api/tickets/:id/block",
    async (req, reply) => {
      if (!req.body.reason) return reply.code(400).send({ error: "reason is required" });
      const existing = await getTicket(req.params.id);
      if (!existing) return reply.code(404).send({ error: "not found" });

      const ticket = await transitionTicket(req.params.id, "blocked");
      broadcastToUi({
        type: "log_line",
        ticketId: ticket.id,
        line: `[blocked] ${req.body.reason}`,
        ts: new Date().toISOString(),
      });

      const message =
        `티켓 ${ticket.id}(${ticket.title}, project=${ticket.project}, role=${ticket.role})가 ` +
        `blocked 상태입니다. 사유: ${req.body.reason}\n\n` +
        `list_tickets/get_ticket으로 확인하고, 다른 직원에게 위임이 필요하면 create_ticket으로 ` +
        `새 티켓을 만들되 parentTicketId를 "${ticket.id}"로 설정하세요 - 그 티켓이 done이 되면 ` +
        `이 티켓이 자동으로 재개됩니다.`;
      requestManagerInvocation(ticket.teamId, message);

      return ticket;
    }
  );
}
