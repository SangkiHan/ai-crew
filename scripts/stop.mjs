#!/usr/bin/env node
// 한 번에 다 내리는 스크립트: 백그라운드 러너 프로세스 종료 + docker compose down.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const COMPOSE_FILE = join(REPO_ROOT, "infra", "docker-compose.yml");
const RUN_DIR = join(REPO_ROOT, ".run");
const RUNNER_PID_FILE = join(RUN_DIR, "runner.pid");

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killTree(pid, signal) {
  if (process.platform === "win32") {
    // Windows에는 프로세스 그룹/SIGTERM 개념이 없어서 taskkill로 자식까지(/t) 강제 종료(/f)한다.
    spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"]);
    return;
  }
  // detached로 띄웠으므로 pnpm이 자식으로 띄운 tsx 프로세스까지 같이 죽도록 프로세스 그룹 전체에 신호를 보낸다.
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // 이미 죽었음
    }
  }
}

async function waitForExit(pid, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isRunning(pid)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function stopRunner() {
  if (!existsSync(RUNNER_PID_FILE)) {
    console.log("러너 pid 파일이 없습니다 (이미 꺼져 있거나 `pnpm start`로 띄운 적이 없음).");
    return;
  }

  const pid = Number(readFileSync(RUNNER_PID_FILE, "utf-8").trim());
  if (!pid || !isRunning(pid)) {
    console.log("러너 프로세스가 이미 죽어 있습니다.");
    rmSync(RUNNER_PID_FILE, { force: true });
    return;
  }

  console.log(`[1/2] 러너(pid ${pid})를 종료합니다…`);
  killTree(pid, "SIGTERM");

  const exited = await waitForExit(pid);
  if (!exited) {
    console.log("정상 종료가 안 돼서 강제 종료합니다…");
    killTree(pid, "SIGKILL");
  }

  rmSync(RUNNER_PID_FILE, { force: true });
}

function stopDocker() {
  console.log("[2/2] docker compose를 내립니다 (DB 데이터는 volume에 유지됩니다)…");
  const result = spawnSync("docker", ["compose", "-f", COMPOSE_FILE, "down"], {
    stdio: "inherit",
    cwd: REPO_ROOT,
  });
  if (result.status !== 0) {
    throw new Error(`docker compose down exited with code ${result.status}`);
  }
}

async function main() {
  await stopRunner();
  stopDocker();
  console.log("\n모두 종료되었습니다.");
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
