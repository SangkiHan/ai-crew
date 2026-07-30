#!/usr/bin/env node
// git clone 직후 처음 한 번 실행하는 대화형 설정 스크립트. Node만 있으면 맥/윈도우 어디서나 돈다
// (bash 스크립트가 아니라 Node로 만든 이유). .env가 없을 때만 절대경로를 물어보고 만든다.
import { existsSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = join(REPO_ROOT, ".env");
const ENV_EXAMPLE_PATH = join(REPO_ROOT, ".env.example");

async function main() {
  if (existsSync(ENV_PATH)) {
    console.log(".env가 이미 있습니다. 값을 바꾸고 싶으면 직접 편집하세요:", ENV_PATH);
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const defaultWorkspaceRoot = join(homedir(), "Desktop", "Project");

  console.log("ai-crew 첫 실행 설정을 시작합니다.\n");
  const workspaceRoot =
    (await rl.question(`AI 직원들이 작업할 프로젝트들이 있는 폴더 경로 [${defaultWorkspaceRoot}]: `)).trim() ||
    defaultWorkspaceRoot;

  rl.close();

  let content = readFileSync(ENV_EXAMPLE_PATH, "utf-8");
  content = content.replace(/^WORKSPACE_ROOT=.*$/m, `WORKSPACE_ROOT=${workspaceRoot}`);
  writeFileSync(ENV_PATH, content);

  console.log(`\n.env 생성 완료 (WORKSPACE_ROOT=${workspaceRoot}).`);
  if (process.env.AI_CREW_SKIP_SETUP_HINT !== "1") {
    console.log("이제 `pnpm start`로 전체 서비스를 띄우세요 (Docker Desktop이 켜져 있어야 합니다).");
    console.log("자세한 내용은 README.md를 참고하세요.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
