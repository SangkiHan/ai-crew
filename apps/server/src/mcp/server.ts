#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { askUser, createTicket, getTicket, listProjects, listTickets } from "./tools.js";

// 팀장(Claude Code headless)에게 붙는 MCP 서버. 러너가 `claude -p ... --mcp-config`로
// 이 프로세스를 호스트에서 띄운다. 실제 상태는 여기서 들고 있지 않고, 항상 서버의
// REST API(/tickets, /questions)를 호출한다 - 이 프로세스는 매 invocation마다 새로 뜨는
// stdio 자식 프로세스라 상태를 들고 있으면 안 된다.
const server = new McpServer({ name: "ai-crew-manager-tools", version: "0.0.0" });

server.tool(
  "list_projects",
  "WORKSPACE_ROOT를 스캔해 작업 가능한 프로젝트와 추정 스택(git 여부 포함) 목록을 반환합니다.",
  {},
  async () => {
    const projects = await listProjects();
    return { content: [{ type: "text" as const, text: JSON.stringify(projects, null, 2) }] };
  }
);

server.tool(
  "create_ticket",
  "직원에게 작업을 위임하는 티켓을 생성합니다. 비동기이며 즉시 반환됩니다.",
  {
    role: z.string().describe("담당 직원 역할 (예: backend, frontend)"),
    project: z.string().describe("대상 프로젝트 이름 (list_projects 결과 중 하나)"),
    title: z.string().describe("티켓 제목"),
    spec: z.string().describe("직원에게 전달할 구체적인 작업 지시"),
  },
  async ({ role, project, title, spec }) => {
    const ticket = await createTicket({ role, project, title, spec });
    return { content: [{ type: "text" as const, text: JSON.stringify(ticket, null, 2) }] };
  }
);

server.tool(
  "get_ticket",
  "티켓 하나의 현재 상태와 상세 정보를 조회합니다.",
  { id: z.string().describe("티켓 id") },
  async ({ id }) => {
    const ticket = await getTicket(id);
    return { content: [{ type: "text" as const, text: JSON.stringify(ticket, null, 2) }] };
  }
);

server.tool(
  "list_tickets",
  "현재 티켓 보드 상태를 조회합니다. status로 필터링할 수 있습니다.",
  {
    status: z
      .enum(["queued", "assigned", "running", "review", "blocked", "needs_approval", "done", "failed"])
      .optional()
      .describe("이 상태의 티켓만 조회 (생략하면 전체)"),
  },
  async ({ status }) => {
    const tickets = await listTickets(status);
    return { content: [{ type: "text" as const, text: JSON.stringify(tickets, null, 2) }] };
  }
);

server.tool(
  "ask_user",
  "사람의 판단이 필요할 때 질문을 등록합니다. 지금 단계에서는 UI가 없어 즉시 답을 받지 못할 수 있습니다.",
  { question: z.string().describe("사용자에게 물어볼 질문") },
  async ({ question }) => {
    const result = await askUser(question);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
