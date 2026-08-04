import { PrismaClient } from "@prisma/client";
import { isQaEmployee, type Employee } from "@ai-crew/shared";

const prisma = new PrismaClient();

function toEmployee(row: {
  id: string;
  teamId: string | null;
  name: string;
  driver: string;
  model: string | null;
  taskDescription: string;
  projects: string[];
  allowedTools: string[];
  requireApproval: string[];
  createdAt: Date;
  updatedAt: Date;
}): Employee {
  return {
    id: row.id,
    // ensureDefaultTeamAssigned가 부팅 시 채워 넣으므로 실제로는 항상 값이 있다.
    teamId: row.teamId ?? "",
    name: row.name,
    driver: row.driver as Employee["driver"],
    model: row.model ?? undefined,
    taskDescription: row.taskDescription,
    projects: row.projects,
    allowedTools: row.allowedTools,
    requireApproval: row.requireApproval,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listEmployees(teamId?: string): Promise<Employee[]> {
  const rows = await prisma.employee.findMany({
    where: teamId ? { teamId } : undefined,
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toEmployee);
}

export async function getEmployee(id: string): Promise<Employee | null> {
  const row = await prisma.employee.findUnique({ where: { id } });
  return row ? toEmployee(row) : null;
}

// 이름은 팀 안에서만 유일하다 - 다른 팀에 같은 이름의 직원이 있을 수 있으므로 반드시 팀과 함께
// 찾는다. teamId를 모르는 호출자는 없어야 한다(티켓/기획서/상담 모두 자기 팀 안에서 일어난다).
export async function getEmployeeByName(teamId: string, name: string): Promise<Employee | null> {
  const row = await prisma.employee.findFirst({ where: { teamId, name } });
  return row ? toEmployee(row) : null;
}

// 그 팀에 QA 역할로 보이는 직원이 있는지 찾는다 (taskDescription 키워드 매칭, best-effort).
// 있으면 개발 티켓 완료 시 사람 승인 전에 자동으로 QA 검증 단계를 거친다.
export async function findQaEmployee(teamId: string): Promise<Employee | null> {
  const rows = await prisma.employee.findMany({ where: { teamId } });
  const match = rows.find((r) => isQaEmployee(r.taskDescription));
  return match ? toEmployee(match) : null;
}

export async function createEmployee(input: {
  teamId: string;
  name: string;
  driver: string;
  model?: string;
  taskDescription: string;
  projects: string[];
  allowedTools: string[];
  requireApproval: string[];
}): Promise<Employee> {
  const row = await prisma.employee.create({ data: input });
  return toEmployee(row);
}

export async function updateEmployee(
  id: string,
  input: Partial<{
    teamId: string;
    name: string;
    driver: string;
    model: string | null;
    taskDescription: string;
    projects: string[];
    allowedTools: string[];
    requireApproval: string[];
  }>
): Promise<Employee> {
  const row = await prisma.employee.update({ where: { id }, data: input });
  return toEmployee(row);
}

export async function deleteEmployee(id: string): Promise<void> {
  await prisma.employee.delete({ where: { id } });
}

// Gemini CLI가 2026-06-18 종료되고 Antigravity CLI(agy)로 대체되면서, 예전에 driver="gemini"로
// 만들어진 직원을 부팅 시 자동으로 새 드라이버로 옮긴다. ensureDefaultTeamAssigned와 같은
// 자기치유 패턴 - 매번 불러도 대상이 없으면 아무 일도 안 한다.
export async function migrateLegacyGeminiDriver(): Promise<void> {
  const result = await prisma.employee.updateMany({
    where: { driver: "gemini" },
    data: { driver: "antigravity" },
  });
  if (result.count > 0) {
    console.log(`[migrate] driver=gemini 직원 ${result.count}명을 antigravity로 전환했습니다`);
  }
}

// 팀의 담당 프로젝트 목록이 바뀌었을 때, 더 이상 그 팀 목록에 없는 프로젝트를 직원들의
// projects에서 걷어낸다. 이걸 안 하면 "웹 체크박스에는 안 보이는데 티켓 검증은 통과하는"
// 유령 참조가 남는다 (직원 projects는 항상 Team.projects의 부분집합이어야 한다).
export async function pruneEmployeeProjects(teamId: string, allowedProjects: string[]): Promise<void> {
  const rows = await prisma.employee.findMany({ where: { teamId } });
  await Promise.all(
    rows
      .map((row) => ({ row, next: row.projects.filter((p) => allowedProjects.includes(p)) }))
      .filter(({ row, next }) => next.length !== row.projects.length)
      .map(({ row, next }) => prisma.employee.update({ where: { id: row.id }, data: { projects: next } }))
  );
}
