import { PrismaClient } from "@prisma/client";
import type { Employee } from "@ai-crew/shared";

const prisma = new PrismaClient();

function toEmployee(row: {
  id: string;
  teamId: string | null;
  name: string;
  driver: string;
  model: string | null;
  taskDescription: string;
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

export async function getEmployeeByName(name: string): Promise<Employee | null> {
  const row = await prisma.employee.findUnique({ where: { name } });
  return row ? toEmployee(row) : null;
}

export async function createEmployee(input: {
  teamId: string;
  name: string;
  driver: string;
  model?: string;
  taskDescription: string;
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
