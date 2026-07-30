import type { FastifyInstance } from "fastify";
import { createTicket, getTicket, listTickets } from "../tickets/store.js";

interface CreateTicketBody {
  role: string;
  project: string;
  title: string;
  spec: string;
}

export function registerTicketRoutes(app: FastifyInstance) {
  app.post<{ Body: CreateTicketBody }>("/tickets", async (req, reply) => {
    const { role, project, title, spec } = req.body;
    if (!role || !project || !title || !spec) {
      return reply.code(400).send({ error: "role, project, title, spec are required" });
    }
    // 티켓 push는 store의 ticketEvents("changed") 구독자(ws/runner.ts) 쪽 한 곳에서만 처리한다.
    // 여기서 별도로 pushToAnyRunner를 부르면 같은 티켓이 두 번 assign되는 버그가 생긴다.
    return createTicket({ role, project, title, spec });
  });

  app.get<{ Querystring: { status?: string } }>("/tickets", async (req) => {
    return listTickets(req.query.status);
  });

  app.get<{ Params: { id: string } }>("/tickets/:id", async (req, reply) => {
    const ticket = await getTicket(req.params.id);
    if (!ticket) return reply.code(404).send({ error: "not found" });
    return ticket;
  });
}
