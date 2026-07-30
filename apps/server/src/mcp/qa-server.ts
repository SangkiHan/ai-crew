#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { reportQaResult } from "./tools.js";

// QA 검증 세션에 붙는 MCP 서버. 딱 하나의 티켓 검증에 묶여서 실행되므로(러너가 TICKET_ID를
// env로 주입) 파라미터로 받지 않는다. 코드 수정 툴은 일부러 안 준다 - QA는 판정만 한다.
const TICKET_ID = process.env.TICKET_ID;
if (!TICKET_ID) {
  console.error("mcp/qa-server.ts: TICKET_ID env가 필요합니다");
  process.exit(1);
}

const server = new McpServer({ name: "ai-crew-qa-tools", version: "0.0.0" });

server.tool(
  "report_qa_result",
  "이 티켓의 구현 결과를 검증한 판정을 남깁니다. 통과하면 사람의 최종 승인 단계로 넘어가고, " +
    "반려하면 원래 담당 직원에게 돌아가 수정합니다 (같은 티켓이 3회 넘게 반려되면 사람에게 " +
    "자동으로 알려 판단을 요청합니다). 검증이 끝나면 반드시 이 툴을 호출하세요.",
  {
    pass: z.boolean().describe("요구사항대로 동작하는지 검증 통과 여부"),
    note: z.string().optional().describe("반려 사유(무엇을 어떻게 고쳐야 하는지 구체적으로) 또는 확인한 내용"),
  },
  async ({ pass, note }) => {
    const result = await reportQaResult(TICKET_ID!, pass, note);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
