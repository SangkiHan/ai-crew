import { PrismaClient } from "@prisma/client";
import type { Employee } from "@ai-crew/shared";

const prisma = new PrismaClient();

function toEmployee(row: {
  id: string;
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

export async function listEmployees(): Promise<Employee[]> {
  const rows = await prisma.employee.findMany({ orderBy: { createdAt: "asc" } });
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
