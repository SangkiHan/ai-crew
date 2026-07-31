#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { answerPeerMessage, askPeer, consultEmployee, listEmployees, reportBlocked } from "./tools.js";

// 직원(employee) 드라이버에게 붙는 MCP 서버. 팀장용 server.ts와 달리 딱 하나의 티켓/직원에
// 묶여서 실행되므로(러너가 TICKET_ID/EMPLOYEE_NAME을 env로 주입), 그 값을 파라미터로 받지 않는다.
// create_ticket은 일부러 안 준다 - 큰 에스컬레이션은 항상 팀장을 거치게(report_blocked),
// 사소한 건 동료에게 직접 텍스트로(ask_peer), 다른 프로젝트의 실제 구현을 확인해야 하면
// 그 프로젝트를 열어서(ask_employee) - 이렇게 표면을 좁게 유지한다.
const TICKET_ID = process.env.TICKET_ID;
const EMPLOYEE_NAME = process.env.EMPLOYEE_NAME;
const TEAM_ID = process.env.TEAM_ID;
if (!TICKET_ID || !EMPLOYEE_NAME || !TEAM_ID) {
  console.error("employee-server.ts: TICKET_ID, EMPLOYEE_NAME, TEAM_ID env가 필요합니다");
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

server.tool(
  "list_employees",
  "동료 직원 목록을 담당 업무 설명과 함께 조회합니다. ask_peer/ask_employee로 누구에게 물어볼지 " +
    "정할 때 쓰세요.",
  {},
  async () => {
    const employees = await listEmployees(TEAM_ID!);
    return { content: [{ type: "text" as const, text: JSON.stringify(employees, null, 2) }] };
  }
);

server.tool(
  "ask_peer",
  "팀장을 거치지 않고 동료 직원에게 사소한 질문을 직접 남깁니다. 비동기입니다 - 답을 기다리지 " +
    "말고 하던 작업을 계속하세요. 답은 다음에 티켓을 받을 때 자동으로 보게 됩니다.",
  {
    toName: z.string().describe("물어볼 동료 직원의 이름 (list_employees 결과 중 하나)"),
    question: z.string().describe("구체적인 질문"),
  },
  async ({ toName, question }) => {
    const message = await askPeer(EMPLOYEE_NAME!, toName, question);
    return { content: [{ type: "text" as const, text: JSON.stringify(message, null, 2) }] };
  }
);

server.tool(
  "ask_employee",
  "다른 프로젝트를 담당하는 직원에게 그 프로젝트의 실제 코드를 기반으로 질문하고 답을 받습니다 " +
    "(동기적 - 답이 올 때까지 기다렸다가 반영하세요). ask_peer와 달리 그 직원이 실제로 그 프로젝트 " +
    "코드를 읽어보고 답하므로, API 연동처럼 '실제로 어떻게 구현되어 있는지' 정확히 확인해야 할 때 " +
    "쓰세요. 그 직원은 코드를 수정하지 않고 조사만 해서 답합니다. 아직 구현 전이면 '아직 없다'고 " +
    "정직하게 답합니다 - 미래에 어떻게 만들어질지까지 알려주지는 않으니, 사전에 팀장이 스펙을 " +
    "못박아주지 않은 새 기능이라면 이 답만으로 통합을 확정하지 말고 담당 직원과 계속 소통하세요.",
  {
    employeeName: z.string().describe("물어볼 직원의 이름 (list_employees 결과 중 하나)"),
    project: z.string().describe("그 직원이 담당하는 프로젝트 이름 또는 절대경로"),
    question: z.string().describe("구체적인 질문 (예: 'remark 필드가 실제 응답에 어떤 이름/타입으로 내려오나요?')"),
  },
  async ({ employeeName, project, question }) => {
    const result = await consultEmployee(TEAM_ID!, employeeName, project, question, EMPLOYEE_NAME!);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "answer_peer_message",
  "동료가 남긴 질문에 답합니다. 이번 작업 지시 맨 앞에 미답변 질문이 있으면 이 툴로 답하세요.",
  {
    id: z.string().describe("답할 질문의 id"),
    answer: z.string().describe("답변 내용"),
  },
  async ({ id, answer }) => {
    const message = await answerPeerMessage(id, answer);
    return { content: [{ type: "text" as const, text: JSON.stringify(message, null, 2) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
