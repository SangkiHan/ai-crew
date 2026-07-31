import type { FastifyInstance } from "fastify";
import { ticketBranchName, type Ticket } from "@ai-crew/shared";
import { applyQaVerdict, createTicket, getTicket, listTickets, transitionTicket } from "../tickets/store.js";
import { getEmployeeByName } from "../employees/store.js";
import { getTeam } from "../teams/store.js";
import { saveMemory } from "../memory/store.js";
import { pushToAnyRunner, requestManagerInvocation, requestMerge } from "../ws/runner.js";
import { broadcastToUi } from "../ws/ui.js";

// 경로 구분자가 "/"든 "\"든(서버는 리눅스 컨테이너 안이라 윈도우 경로의 "\"를 node:path가
// 못 알아본다) 마지막 세그먼트만 뽑아낸다 - 등록된 프로젝트 절대경로와 이름만으로 비교할 때 쓴다.
function lastPathSegment(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

// 팀장이 "프로젝트 관리"에 등록된 절대경로 대신 이름만(또는 다른 표기로) 넘겨도, 등록된 목록
// 중 이름이 일치하는 게 있으면 그 절대경로로 강제 치환한다 - 팀장(LLM)이 매번 정확한 절대경로를
// 쓸 거라고 프롬프트로만 기대하지 않고, 서버에서 결정적으로 보정한다.
function resolveRegisteredProject(project: string, registeredProjects: string[]): string {
  if (registeredProjects.includes(project)) return project;
  const requestedName = lastPathSegment(project).toLowerCase();
  const match = registeredProjects.find((p) => lastPathSegment(p).toLowerCase() === requestedName);
  return match ?? project;
}

// 팀장이 나중에 search_history로 찾을 수 있도록 완료된 티켓을 임베딩해서 저장한다.
// 응답을 막지 않는다 (로컬 임베딩이라도 수백ms~1초 걸릴 수 있음).
function saveTicketMemory(ticket: Ticket): void {
  saveMemory(ticket.teamId, "ticket", ticket.id, `${ticket.title}\n\n${ticket.spec}`).catch((err) =>
    console.error("티켓 임베딩 저장 실패:", err)
  );
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

  // review -> done, needs_approval -> running. 지금은 사람이 UI에서 직접 누르는 경로만 있다
  // (팀장이 review를 스스로 승인하는 MCP 툴은 아직 없음).
  app.post<{ Params: { id: string } }>("/api/tickets/:id/approve", async (req, reply) => {
    const ticket = await getTicket(req.params.id);
    if (!ticket) return reply.code(404).send({ error: "not found" });
    const wasReview = ticket.status === "review";
    const to = wasReview ? "done" : ticket.status === "needs_approval" ? "running" : null;
    if (!to) return reply.code(400).send({ error: `cannot approve ticket in status ${ticket.status}` });
    const updated = await transitionTicket(ticket.id, to);
    // review -> done 승인은 상태만 바꾸는 게 아니라 실제로 워크트리 브랜치를 메인에 머지해야
    // 다른 티켓(예: blocked였다가 재개된 티켓)이 이 작업의 결과를 볼 수 있다.
    if (wasReview && updated.worktreePath) {
      requestMerge(updated.id, updated.project, ticketBranchName(updated.id), updated.worktreePath);
      saveTicketMemory(updated);
    } else if (!wasReview) {
      // needs_approval -> running: "queued"가 아니라서 store의 changed 리스너가 자동으로
      // 러너에 밀어주지 않는다 - 여기서 직접 밀어줘야 실제로 다시 실행된다.
      await pushToAnyRunner(updated.id);
    }
    return updated;
  });

  app.post<{ Params: { id: string } }>("/api/tickets/:id/reject", async (req, reply) => {
    const ticket = await getTicket(req.params.id);
    if (!ticket) return reply.code(404).send({ error: "not found" });
    if (ticket.status !== "review" && ticket.status !== "needs_approval") {
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
      if (pass && ticket.worktreePath) {
        // QA 통과 = done이므로, 승인 때와 마찬가지로 실제 워크트리 브랜치를 메인에 머지해야 한다.
        requestMerge(ticket.id, ticket.project, ticketBranchName(ticket.id), ticket.worktreePath);
        saveTicketMemory(ticket);
      } else if (!pass && !escalated) {
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
