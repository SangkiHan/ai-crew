#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  askUser,
  createPlanningDoc,
  createProject,
  createTicket,
  getTicket,
  listEmployees,
  listProjects,
  listTickets,
  queryDb,
  reviseTicket,
  scheduleTicketRetry,
  searchHistory,
} from "./tools.js";

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
  "현재 등록된 직원 목록을 담당 업무 설명(taskDescription)과 담당 프로젝트(projects)와 함께 " +
    "반환합니다. 티켓을 만들기 전에 이걸로 어떤 직원(role)에게 맡길지 확인하세요. projects가 " +
    "비어있지 않은 직원에게는 그 목록에 있는 프로젝트의 티켓만 만들 수 있습니다(그 외에는 서버가 " +
    "거부합니다). projects가 빈 배열이면 팀의 모든 프로젝트를 담당한다는 뜻입니다.",
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
    needsQa: z
      .boolean()
      .describe(
        "QA 검증이 필요한 티켓인지 매번 판단해서 명시하세요. 핵심 로직/데이터 스키마/결제·인증 등 " +
          "실패 비용이 큰 변경만 true로, 문구·스타일·단순 화면 작업처럼 되돌리기 쉬운 변경은 " +
          "false로 - QA 세션도 사용량을 소모하므로 위험한 변경만 선별해서 검증합니다."
      ),
    parentTicketId: z
      .string()
      .optional()
      .describe(
        "이 티켓이 다른 blocked 티켓을 풀어주기 위한 것이라면 그 티켓의 id. " +
          "이 티켓이 done이 되면 원래 티켓이 자동으로 재개됩니다."
      ),
  },
  async ({ role, project, title, spec, needsQa, parentTicketId }) => {
    const ticket = await createTicket({ teamId: TEAM_ID!, role, project, title, spec, needsQa, parentTicketId });
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
      .enum([
        "queued",
        "assigned",
        "running",
        "qa_review",
        "review",
        "blocked",
        "needs_approval",
        "done",
        "failed",
      ])
      .optional()
      .describe("이 상태의 티켓만 조회 (생략하면 전체)"),
  },
  async ({ status }) => {
    const tickets = await listTickets(TEAM_ID!, status);
    return { content: [{ type: "text" as const, text: JSON.stringify(tickets, null, 2) }] };
  }
);

server.tool(
  "revise_ticket",
  "사용자가 이미 완료(done)되었거나 검수 대기(review) 중인 티켓에 대해 수정을 요청하면 이 툴을 " +
    "쓰세요. 새 티켓을 또 만드는 게 아니라, 그 티켓을 작업했던 담당 직원의 Claude Code 세션을 " +
    "그대로 이어서(--resume) 수정사항만 반영합니다 - 방금 자기가 뭘 했는지 전부 기억한 채로 " +
    "이어가므로 새로 설명할 필요가 없습니다. list_tickets/get_ticket으로 대상 티켓을 먼저 찾으세요.",
  {
    ticketId: z.string().describe("수정할 티켓의 id (list_tickets/get_ticket 결과 중 하나)"),
    message: z.string().describe("사용자가 요청한 수정 내용 그대로"),
  },
  async ({ ticketId, message }) => {
    const ticket = await reviseTicket(ticketId, TEAM_ID!, message);
    return { content: [{ type: "text" as const, text: JSON.stringify(ticket, null, 2) }] };
  }
);

server.tool(
  "schedule_ticket_retry",
  "직원 실패 보고를 확인해 사용량/session 제한으로 판단될 때만 사용합니다. " +
    "지정한 시간이 지나면 같은 티켓을 자동으로 다시 실행합니다. 코드 오류, 권한 오류, " +
    "컨텍스트 초과는 예약하지 마세요.",
  {
    ticketId: z.string().describe("재실행할 failed 티켓 id"),
    delayMinutes: z.number().int().min(1).max(10080).describe("몇 분 후 재실행할지"),
    reason: z.string().describe("사용량/session 제한이라고 판단한 근거와 원문 오류"),
  },
  async ({ ticketId, delayMinutes, reason }) => {
    const ticket = await scheduleTicketRetry(ticketId, TEAM_ID!, delayMinutes, reason);
    return { content: [{ type: "text" as const, text: JSON.stringify(ticket, null, 2) }] };
  }
);

server.tool(
  "create_planning_doc",
  "사용자가 채팅에서 '기획' 모드로 요청했을 때만 사용합니다. 코드 티켓이 아니라 서비스 기획서를 " +
    "만듭니다 - list_employees에서 서비스 기획을 담당하는 직원을 찾아 위임하세요 (당신이 직접 " +
    "기획서를 쓰지 마세요). 기획서가 완성되면 사용자가 검토 후 승인/거부하며, 승인되면 그 내용을 " +
    "바탕으로 당신에게 다시 개발 티켓 발행을 요청하는 메시지가 옵니다.",
  {
    employeeName: z.string().describe("기획을 맡을 직원의 이름 (list_employees 결과 중 하나)"),
    request: z.string().describe("사용자의 원래 기획 요청 내용 그대로"),
  },
  async ({ employeeName, request }) => {
    const doc = await createPlanningDoc(TEAM_ID!, employeeName, request);
    return { content: [{ type: "text" as const, text: JSON.stringify(doc, null, 2) }] };
  }
);

server.tool(
  "create_project",
  "list_projects에 없는 완전히 새 프로젝트를 만듭니다. 사용자가 git 저장소 주소를 줬으면 그 " +
    "자리에 클론하고, 안 줬으면 새로 초기화합니다(git init). 저장소가 완전히 비어있어도(커밋이 " +
    "하나도 없어도) 자동으로 초기 커밋을 만들어서 작업 가능한 상태로 준비합니다. stack을 " +
    "지정하면(예: spring-boot-gradle) 이미 만들어둔 기본 코딩 컨벤션(CLAUDE.md, .claude/skills)이 " +
    "자동으로 채워집니다 - 알고 있는 스택이면 항상 지정하세요. 완료되면 그 이름을 create_ticket의 " +
    "project 값으로 그대로 쓰면 됩니다.",
  {
    name: z.string().describe("프로젝트 폴더 이름 (영문/숫자/.-_ 만 가능, WORKSPACE_ROOT 아래 생성됨)"),
    gitUrl: z.string().optional().describe("클론할 git 저장소 주소. 없으면 새로 초기화합니다."),
    stack: z
      .enum(["spring-boot-gradle"])
      .optional()
      .describe("알려진 스택이면 기본 CLAUDE.md/.claude/skills가 자동으로 채워집니다"),
  },
  async ({ name, gitUrl, stack }) => {
    const result = await createProject(name, gitUrl, stack);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "search_history",
  "우리 팀이 과거에 완료한 티켓/승인된 기획서를 자연어로 의미 검색합니다. 정확한 id나 제목을 " +
    "몰라도 됩니다 (예: '즐겨찾기 관련 작업'). 지금 대화에서 이미 기억하고 있는 내용이면 이 툴을 " +
    "쓸 필요 없습니다 - 세션이 재시작됐거나, 오래돼서 잘 기억이 안 나거나, 사용자가 옛날 일을 " +
    "물어볼 때만 보조로 쓰세요.",
  {
    query: z.string().describe("찾고 싶은 내용을 자연어로"),
    limit: z.number().optional().describe("최대 결과 개수 (기본 5)"),
  },
  async ({ query, limit }) => {
    const results = await searchHistory(TEAM_ID!, query, limit);
    return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
  }
);

server.tool(
  "query_db",
  "팀 설정에 등록된 dev/prod DB에 SELECT 쿼리를 실행해 실제 데이터를 확인합니다. SELECT(및 " +
    "WITH ... SELECT) 외의 구문(INSERT/UPDATE/DELETE/ALTER/CREATE 등)은 서버가 거부합니다 - " +
    "조회 전용입니다. prod는 실제 서비스 데이터이므로 신중하게 조회하고, 결과가 많을 수 있는 " +
    "쿼리는 WHERE/LIMIT을 직접 붙이세요.",
  {
    env: z.enum(["dev", "prod"]).describe("조회할 DB (팀 설정에 등록되어 있어야 함)"),
    sql: z.string().describe("실행할 SELECT 쿼리 (세미콜론으로 여러 statement를 이어 쓸 수 없음)"),
  },
  async ({ env, sql }) => {
    const result = await queryDb(TEAM_ID!, env, sql);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
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
