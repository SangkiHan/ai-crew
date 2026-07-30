#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { reportBlocked } from "./tools.js";

// 직원(employee) 드라이버에게 붙는 MCP 서버. 팀장용 server.ts와 달리 딱 하나의 티켓에
// 묶여서 실행되므로(러너가 TICKET_ID를 env로 주입), 그 티켓 id를 파라미터로 받지 않는다.
// 직원에게는 이거 하나만 준다 - create_ticket 등을 주면 직원끼리 티켓을 남발할 수 있어서
// (에스컬레이션은 항상 팀장을 거치게) 의도적으로 표면을 좁게 유지한다.
const TICKET_ID = process.env.TICKET_ID;
if (!TICKET_ID) {
  console.error("employee-server.ts: TICKET_ID env가 필요합니다");
  process.exit(1);
}

const server = new McpServer({ name: "ai-crew-employee-tools", version: "0.0.0" });

server.tool(
  "report_blocked",
  "지금 하고 있는 작업을 계속할 수 없을 때 (다른 직원의 도움이 필요할 때) 팀장에게 보고합니다. " +
    "직접 다른 프로젝트를 건드리지 말고 이 툴로 이유를 구체적으로 남기세요.",
  { reason: z.string().describe("무엇이 왜 막혔는지 구체적으로") },
  async ({ reason }) => {
    const ticket = await reportBlocked(TICKET_ID!, reason);
    return { content: [{ type: "text" as const, text: JSON.stringify(ticket, null, 2) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
