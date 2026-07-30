import { join } from "node:path";

export const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT ?? join(process.env.HOME ?? "", "Desktop/Project");

export function projectPath(project: string): string {
  return join(WORKSPACE_ROOT, project);
}
