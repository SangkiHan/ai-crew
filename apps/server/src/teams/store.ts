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

// 직원이 남아있으면 라우트(routes/teams.ts)가 미리 409로 막아주지만, 채팅 세션/메시지·팀
// 기억(MemoryEntry)·기획서·티켓은 그런 가드가 없어 team.delete()가 FK 제약 위반으로 그대로
// 실패했다(P2003). 이 4개는 사람이 직접 관리하는 설정이 아니라 팀이 만들어낸 이력이므로,
// 팀을 지울 때 같이 정리한다 - 순서는 ChatMessage가 ChatSession을 참조하므로 그보다 먼저.
export async function deleteTeam(id: string): Promise<void> {
  await prisma.$transaction([
    prisma.chatMessage.deleteMany({ where: { teamId: id } }),
    prisma.chatSession.deleteMany({ where: { teamId: id } }),
    prisma.memoryEntry.deleteMany({ where: { teamId: id } }),
    prisma.planningDoc.deleteMany({ where: { teamId: id } }),
    prisma.ticket.deleteMany({ where: { teamId: id } }),
    prisma.team.delete({ where: { id } }),
  ]);
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
