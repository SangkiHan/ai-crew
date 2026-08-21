import { readdir, access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProjectInfo } from "@ai-crew/shared";

const SERVER_URL = process.env.AI_CREW_SERVER_URL ?? "http://localhost:8080";
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT ?? join(homedir(), "Desktop", "Project");

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function guessStack(projectPath: string): Promise<ProjectInfo["stackGuess"]> {
  if (await exists(join(projectPath, "build.gradle"))) return "spring-boot-gradle";
  if (await exists(join(projectPath, "package.json"))) return "node-react";
  return "unknown";
}

// 정적 목록이 아니라 WORKSPACE_ROOT를 매번 스캔한다 - 사용자가 폴더를 직접 추가/생성할 수 있으므로.
export async function listProjects(): Promise<ProjectInfo[]> {
  const entries = await readdir(WORKSPACE_ROOT, { withFileTypes: true });
  const projects: ProjectInfo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const projectPath = join(WORKSPACE_ROOT, entry.name);
    projects.push({
      name: entry.name,
      path: projectPath,
      isGitRepo: await exists(join(projectPath, ".git")),
      stackGuess: await guessStack(projectPath),
    });
  }
  return projects;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${init?.method ?? "GET"} ${path} failed: ${res.status} ${body}`);
  }
  return res.json() as Promise<T>;
}

export function createTicket(input: {
  teamId: string;
  role: string;
  project: string;
  title: string;
  spec: string;
  parentTicketId?: string;
  needsQa?: boolean;
}) {
  return api("/api/tickets", { method: "POST", body: JSON.stringify(input) });
}

// 티켓 상세는 그 티켓의 teamId가 호출한 팀장의 teamId와 같을 때만 보여준다 - 팀 간 격리.
export async function getTicket(id: string, teamId: string) {
  const ticket = await api<{ teamId: string }>(`/api/tickets/${id}`);
  if (ticket.teamId !== teamId) {
    throw new Error(`티켓 ${id}는 다른 팀 소속이라 조회할 수 없습니다`);
  }
  return ticket;
}

export function listTickets(teamId: string, status?: string) {
  const qs = new URLSearchParams({ teamId });
  if (status) qs.set("status", status);
  return api(`/api/tickets?${qs}`);
}

// 팀장의 revise_ticket MCP 툴 전용 - 사용자가 채팅으로 "이거 이렇게 고쳐줘" 하면, 새 티켓을
// 새로 만드는 대신 그 티켓을 작업했던 담당 직원의 세션을 그대로 이어서(--resume) 수정하게
// 한다. getTicket과 같은 이유로 팀 소속을 먼저 확인한다 - 다른 팀 티켓은 건드릴 수 없다.
export async function reviseTicket(id: string, teamId: string, message: string) {
  const ticket = await api<{ teamId: string }>(`/api/tickets/${id}`);
  if (ticket.teamId !== teamId) {
    throw new Error(`티켓 ${id}는 다른 팀 소속이라 수정 요청할 수 없습니다`);
  }
  return api(`/api/tickets/${id}/revise`, { method: "POST", body: JSON.stringify({ message }) });
}

// 팀장이 직원 보고를 확인해 사용량 제한으로 판단한 경우에만 자동 재실행을 예약한다.
export async function scheduleTicketRetry(id: string, teamId: string, delayMinutes: number, reason: string) {
  const ticket = await api<{ teamId: string }>(`/api/tickets/${id}`);
  if (ticket.teamId !== teamId) throw new Error(`티켓 ${id}는 다른 팀 소속이라 재실행 예약할 수 없습니다`);
  return api(`/api/tickets/${id}/schedule-retry`, {
    method: "POST",
    body: JSON.stringify({ delayMinutes, reason }),
  });
}

// 직원(employee) 전용 - report_blocked MCP 툴이 사용. 진행 중인 티켓 하나에 고정되어 있으므로
// ticketId는 파라미터로 안 받고 MCP 서버가 자기 프로세스의 env(TICKET_ID)에서 읽어 넘긴다.
export function reportBlocked(ticketId: string, reason: string) {
  return api(`/api/tickets/${ticketId}/block`, { method: "POST", body: JSON.stringify({ reason }) });
}

// QA 직원 전용 - report_qa_result MCP 툴이 사용. report_blocked와 같은 패턴으로,
// 검증 대상 티켓 id는 MCP 서버가 자기 프로세스의 env(TICKET_ID)에서 읽어 넘긴다.
export function reportQaResult(ticketId: string, pass: boolean, note?: string) {
  return api(`/api/tickets/${ticketId}/qa-result`, { method: "POST", body: JSON.stringify({ pass, note }) });
}

export function listEmployees(teamId: string) {
  return api(`/api/employees?teamId=${encodeURIComponent(teamId)}`);
}

// 직원 간 비동기 소통 - 팀장을 거치지 않는다. 보내는 쪽(fromName)은 답을 기다리지 않고 계속 작업한다.
// 이름은 팀 안에서만 유일하므로 teamId를 함께 넘긴다 - 다른 팀 동명이인에게 새면 안 된다.
export function askPeer(teamId: string, fromName: string, toName: string, question: string) {
  return api("/api/peer-messages", {
    method: "POST",
    body: JSON.stringify({ teamId, fromName, toName, question }),
  });
}

export function listPeerMessagesFor(teamId: string, toName: string, status = "open") {
  const qs = new URLSearchParams({ teamId, toName, status });
  return api(`/api/peer-messages?${qs}`);
}

export function answerPeerMessage(id: string, answer: string) {
  return api(`/api/peer-messages/${id}/answer`, { method: "POST", body: JSON.stringify({ answer }) });
}

// 팀장의 create_planning_doc MCP 툴 전용 - 코드 티켓이 아니라 기획서를 만든다.
export function createPlanningDoc(teamId: string, employeeName: string, request: string) {
  return api("/api/planning-docs", { method: "POST", body: JSON.stringify({ teamId, employeeName, request }) });
}

// 팀장의 search_history MCP 툴 전용 - 완료된 티켓/승인된 기획서를 의미로 검색한다.
export function searchHistory(teamId: string, query: string, limit?: number) {
  const qs = new URLSearchParams({ teamId, query });
  if (limit) qs.set("limit", String(limit));
  return api(`/api/memory/search?${qs}`);
}

// 팀장의 create_project MCP 툴 전용 - WORKSPACE_ROOT 아래에 새 프로젝트를 만든다
// (git clone 또는 git init). 실제 작업은 호스트(러너)에서 진행된다.
export function createProject(name: string, gitUrl?: string, stack?: string) {
  return api("/api/projects", { method: "POST", body: JSON.stringify({ name, gitUrl, stack }) });
}

// 기획자/직원의 ask_employee MCP 툴 전용 - 이미 있는 서비스에 기능을 추가하는 기획일 때, 그 프로젝트
// 담당 직원에게 기존 구조/컨벤션을 직접 물어보고 동기적으로 답을 받는다 (ask_peer와 달리 비동기가
// 아니다 - 기획 세션 안에서 바로 답을 받아 기획서에 반영해야 하므로). 실제 조사는 호스트(러너)에서
// 그 프로젝트 폴더를 읽기 전용으로 열어보는 임시 세션으로 진행된다.
// fromEmployeeName은 질문자 쪽 표시용(누가 물어보고 있는지 org chart에 띄우기)이라 옵션이다 -
// 기획 세션에서 호출할 때는 질문자에 대응하는 직원 카드가 없어 안 넘어올 수 있다.
export function consultEmployee(
  teamId: string,
  employeeName: string,
  project: string,
  question: string,
  fromEmployeeName?: string
) {
  return api("/api/consult", {
    method: "POST",
    body: JSON.stringify({ teamId, employeeName, project, question, fromEmployeeName }),
  });
}

// 팀장/직원의 query_db MCP 툴 전용 - 팀 설정에 등록된 dev/prod DB를 SELECT로만 조회한다
// (그 외 구문은 서버가 거부한다, apps/server/src/db-query/run.ts).
export function queryDb(teamId: string, env: "dev" | "prod", sql: string) {
  return api(`/api/teams/${teamId}/db-query`, { method: "POST", body: JSON.stringify({ env, sql }) });
}

export async function askUser(question: string) {
  const created = await api<{ id: string }>("/api/questions", {
    method: "POST",
    body: JSON.stringify({ text: question }),
  });
  return {
    questionId: created.id,
    note:
      "질문이 등록되었습니다 (아직 UI에 질문창이 없어 사람이 GET /api/questions 로 직접 확인하고 " +
      `POST /api/questions/${created.id}/answer 로 답합니다). 답을 기다릴 수 없다면 보수적으로 판단해 진행하세요.`,
  };
}
