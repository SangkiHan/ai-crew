#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { askUser, createTicket, getTicket, listEmployees, listProjects, listTickets } from "./tools.js";

// 팀장(Claude Code headless)에게 붙는 MCP 서버. 러너가 `claude -p ... --mcp-config`로
// 이 프로세스를 호스트에서 띄운다. 실제 상태는 여기서 들고 있지 않고, 항상 서버의
// REST API(/tickets, /questions)를 호출한다 - 이 프로세스는 매 invocation마다 새로 뜨는
// stdio 자식 프로세스라 상태를 들고 있으면 안 된다.
// TEAM_ID: 이 팀장이 어느 팀을 위해 호출됐는지 - 여러 팀이 생기면서 직원/티켓 조회·생성을
// 자기 팀 범위로만 제한하기 위해 러너가 env로 주입한다.
const TEAM_ID = process.env.TEAM_ID;
if (!TEAM_ID) {
  console.error("mcp/server.ts: TEAM_ID env가 필요합니다");
  process.exit(1);
}

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
  "list_employees",
  "현재 등록된 직원 목록을 담당 업무 설명과 함께 반환합니다. 티켓을 만들기 전에 " +
    "이걸로 어떤 직원(role)에게 맡길지 확인하세요.",
  {},
  async () => {
    const employees = await listEmployees(TEAM_ID!);
    return { content: [{ type: "text" as const, text: JSON.stringify(employees, null, 2) }] };
  }
);

server.tool(
  "create_ticket",
  "직원에게 작업을 위임하는 티켓을 생성합니다. 비동기이며 즉시 반환됩니다.",
  {
    role: z.string().describe("담당 직원의 이름/id (list_employees 결과 중 하나)"),
    project: z
      .string()
      .describe(
        "대상 프로젝트 이름(list_projects 결과 중 하나) 또는 임의의 절대경로. " +
          "WORKSPACE_ROOT 밖의 프로젝트라도 사용자가 절대경로를 알려주면 그대로 써도 됩니다."
      ),
    title: z.string().describe("티켓 제목"),
    spec: z.string().describe("직원에게 전달할 구체적인 작업 지시"),
    parentTicketId: z
      .string()
      .optional()
      .describe(
        "이 티켓이 다른 blocked 티켓을 풀어주기 위한 것이라면 그 티켓의 id. " +
          "이 티켓이 done이 되면 원래 티켓이 자동으로 재개됩니다."
      ),
  },
  async ({ role, project, title, spec, parentTicketId }) => {
    const ticket = await createTicket({ teamId: TEAM_ID!, role, project, title, spec, parentTicketId });
    return { content: [{ type: "text" as const, text: JSON.stringify(ticket, null, 2) }] };
  }
);

server.tool(
  "get_ticket",
  "티켓 하나의 현재 상태와 상세 정보를 조회합니다. 우리 팀 티켓만 조회할 수 있습니다.",
  { id: z.string().describe("티켓 id") },
  async ({ id }) => {
    const ticket = await getTicket(id, TEAM_ID!);
    return { content: [{ type: "text" as const, text: JSON.stringify(ticket, null, 2) }] };
  }
);

server.tool(
  "list_tickets",
  "우리 팀의 티켓 보드 상태를 조회합니다. status로 필터링할 수 있습니다.",
  {
    status: z
      .enum(["queued", "assigned", "running", "review", "blocked", "needs_approval", "done", "failed"])
      .optional()
      .describe("이 상태의 티켓만 조회 (생략하면 전체)"),
  },
  async ({ status }) => {
    const tickets = await listTickets(TEAM_ID!, status);
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
