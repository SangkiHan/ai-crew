import { PrismaClient } from "@prisma/client";
import type { Driver, Team } from "@ai-crew/shared";

const prisma = new PrismaClient();

function toTeam(row: {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  projects: string[];
  managerModel: string | null;
  managerDriver: string;
}): Team {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    projects: row.projects,
    managerModel: row.managerModel,
    managerDriver: row.managerDriver as Driver,
  };
}

export async function listTeams(): Promise<Team[]> {
  const rows = await prisma.team.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map(toTeam);
}

export async function getTeam(id: string): Promise<Team | null> {
  const row = await prisma.team.findUnique({ where: { id } });
  return row ? toTeam(row) : null;
}

export async function createTeam(name: string, projects?: string[]): Promise<Team> {
  const row = await prisma.team.create({ data: { name, projects: projects ?? [] } });
  return toTeam(row);
}

export async function updateTeamProjects(id: string, projects: string[]): Promise<Team> {
  const row = await prisma.team.update({ where: { id }, data: { projects } });
  return toTeam(row);
}

// driver를 바꿀 때는 model도 함께 받는다(둘 다 null/생략 가능) - 드라이버가 바뀌면 이전
// 드라이버 기준으로 고른 모델 값이 새 드라이버에 안 맞을 수 있어서, 호출부(routes/teams.ts)가
// 항상 새 드라이버에 맞는 모델(또는 null=기본값)로 같이 갱신한다.
export async function updateTeamManagerConfig(
  id: string,
  driver: Driver,
  model: string | null
): Promise<Team> {
  const row = await prisma.team.update({ where: { id }, data: { managerDriver: driver, managerModel: model } });
  return toTeam(row);
}

export async function deleteTeam(id: string): Promise<void> {
  await prisma.team.delete({ where: { id } });
}

export async function countEmployeesInTeam(id: string): Promise<number> {
  return prisma.employee.count({ where: { teamId: id } });
}

// 서버 부팅 시 한 번 호출된다. 팀이 하나도 없으면 "기본 팀"을 만들고, teamId가 비어있는
// (팀 기능 추가 전부터 있던) 기존 직원/티켓을 전부 그 팀으로 채워 넣는다 - 기존 설치도
// 데이터 유실 없이 그대로 마이그레이션된다.
export async function ensureDefaultTeamAssigned(): Promise<void> {
  let defaultTeam = await prisma.team.findFirst({ orderBy: { createdAt: "asc" } });
  if (!defaultTeam) {
    defaultTeam = await prisma.team.create({ data: { name: "기본 팀" } });
  }
  await prisma.employee.updateMany({ where: { teamId: null }, data: { teamId: defaultTeam.id } });
  await prisma.ticket.updateMany({ where: { teamId: null }, data: { teamId: defaultTeam.id } });
}
