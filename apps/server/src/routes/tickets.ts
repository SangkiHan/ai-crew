import type { FastifyInstance } from "fastify";
import { createTicket, getTicket, listTickets, transitionTicket } from "../tickets/store.js";

interface CreateTicketBody {
  role: string;
  project: string;
  title: string;
  spec: string;
}

export function registerTicketRoutes(app: FastifyInstance) {
  app.post<{ Body: CreateTicketBody }>("/api/tickets", async (req, reply) => {
    const { role, project, title, spec } = req.body;
    if (!role || !project || !title || !spec) {
      return reply.code(400).send({ error: "role, project, title, spec are required" });
    }
    // 티켓 push는 store의 ticketEvents("changed") 구독자(ws/runner.ts) 쪽 한 곳에서만 처리한다.
    // 여기서 별도로 pushToAnyRunner를 부르면 같은 티켓이 두 번 assign되는 버그가 생긴다.
    return createTicket({ role, project, title, spec });
  });

  app.get<{ Querystring: { status?: string } }>("/api/tickets", async (req) => {
    return listTickets(req.query.status);
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
    const to = ticket.status === "review" ? "done" : ticket.status === "needs_approval" ? "running" : null;
    if (!to) return reply.code(400).send({ error: `cannot approve ticket in status ${ticket.status}` });
    return transitionTicket(ticket.id, to);
  });

  app.post<{ Params: { id: string } }>("/api/tickets/:id/reject", async (req, reply) => {
    const ticket = await getTicket(req.params.id);
    if (!ticket) return reply.code(404).send({ error: "not found" });
    if (ticket.status !== "review" && ticket.status !== "needs_approval") {
      return reply.code(400).send({ error: `cannot reject ticket in status ${ticket.status}` });
    }
    return transitionTicket(ticket.id, "failed");
  });
}
