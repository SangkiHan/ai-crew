#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { consultEmployee, listEmployees, listProjects } from "./tools.js";

// 기획(planning) 세션에게 붙는 MCP 서버. 코드를 만들지 않으므로 create_ticket/create_project는
// 일부러 안 준다 - 이미 있는 서비스에 기능을 추가하는 기획일 때 담당 직원에게 직접 물어볼 수
// 있는 것(ask_employee)만 좁게 열어준다.
const TEAM_ID = process.env.TEAM_ID;
if (!TEAM_ID) {
  console.error("mcp/planning-server.ts: TEAM_ID env가 필요합니다");
  process.exit(1);
}

const server = new McpServer({ name: "ai-crew-planning-tools", version: "0.0.0" });

server.tool(
  "list_projects",
  "WORKSPACE_ROOT를 스캔해 존재하는 프로젝트 목록을 반환합니다. ask_employee에 넘길 project 값을 " +
    "확인할 때 쓰세요.",
  {},
  async () => {
    const projects = await listProjects();
    return { content: [{ type: "text" as const, text: JSON.stringify(projects, null, 2) }] };
  }
);

server.tool(
  "list_employees",
  "현재 등록된 직원 목록을 담당 업무 설명과 함께 반환합니다. ask_employee로 누구에게 물어볼지 " +
    "정할 때 쓰세요.",
  {},
  async () => {
    const employees = await listEmployees(TEAM_ID!);
    return { content: [{ type: "text" as const, text: JSON.stringify(employees, null, 2) }] };
  }
);

server.tool(
  "ask_employee",
  "이미 있는 서비스에 새 기능을 기획할 때, 그 프로젝트 담당 직원에게 기존 구조/컨벤션/제약을 " +
    "직접 물어보고 답을 받습니다 (동기적 - 답이 올 때까지 기다렸다가 기획서에 반영하세요). " +
    "그 직원은 코드를 수정하지 않고 조사만 해서 답합니다.",
  {
    employeeName: z.string().describe("물어볼 직원의 이름 (list_employees 결과 중 하나)"),
    project: z.string().describe("그 직원이 담당하는 프로젝트 이름 (list_projects 결과 중 하나) 또는 절대경로"),
    question: z.string().describe("구체적인 질문 (예: '즐겨찾기 기능이 이미 있나요? 있다면 API 스펙은?')"),
  },
  async ({ employeeName, project, question }) => {
    const result = await consultEmployee(TEAM_ID!, employeeName, project, question);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
