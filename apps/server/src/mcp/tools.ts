import { readdir, access } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectInfo } from "@ai-crew/shared";

const SERVER_URL = process.env.AI_CREW_SERVER_URL ?? "http://localhost:8080";
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT ?? join(process.env.HOME ?? "", "Desktop/Project");

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
  role: string;
  project: string;
  title: string;
  spec: string;
  parentTicketId?: string;
}) {
  return api("/api/tickets", { method: "POST", body: JSON.stringify(input) });
}

export function getTicket(id: string) {
  return api(`/api/tickets/${id}`);
}

export function listTickets(status?: string) {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return api(`/api/tickets${qs}`);
}

// 직원(employee) 전용 - report_blocked MCP 툴이 사용. 진행 중인 티켓 하나에 고정되어 있으므로
// ticketId는 파라미터로 안 받고 MCP 서버가 자기 프로세스의 env(TICKET_ID)에서 읽어 넘긴다.
export function reportBlocked(ticketId: string, reason: string) {
  return api(`/api/tickets/${ticketId}/block`, { method: "POST", body: JSON.stringify({ reason }) });
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
