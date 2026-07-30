#!/usr/bin/env node
// 한 번에 다 띄우는 스크립트: docker compose(서버/웹/DB/Caddy) + DB 스키마 동기화 + 러너(호스트).
// 러너는 git worktree/JDK/Gradle/claude·gemini·codex CLI가 필요해서 컨테이너 안에 넣을 수 없다 -
// 그래서 docker는 백그라운드로 띄우고, 이 스크립트 자체가 마지막에 러너로 넘어가 포그라운드로 로그를 보여준다.
import { existsSync, readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const COMPOSE_FILE = join(REPO_ROOT, "infra", "docker-compose.yml");
const ENV_PATH = join(REPO_ROOT, ".env");

function readEnvValue(key, fallback) {
  if (!existsSync(ENV_PATH)) return fallback;
  const match = readFileSync(ENV_PATH, "utf-8").match(new RegExp(`^${key}=(.*)$`, "m"));
  return match ? match[1].trim() : fallback;
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: "inherit", cwd: REPO_ROOT, ...opts });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited with code ${result.status}`);
  }
}

async function waitForHealth(url, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // 아직 안 떴음 - 계속 재시도
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function main() {
  if (!existsSync(ENV_PATH)) {
    console.log(".env가 없습니다. 먼저 설정을 진행합니다.\n");
    run(process.execPath, [join(REPO_ROOT, "scripts", "setup.mjs")]);
  }

  const serverPort = readEnvValue("SERVER_PORT", "8080");
  const databaseUrl =
    readEnvValue("DATABASE_URL", "postgresql://aicrew:aicrew@postgres:5432/aicrew").replace(
      "@postgres:",
      "@localhost:"
    ); // 호스트에서 psql 접속용으로 컨테이너 이름을 localhost로 바꿔치기

  console.log("[1/3] docker compose로 서버/웹/DB/Caddy를 띄웁니다…");
  run("docker", ["compose", "-f", COMPOSE_FILE, "up", "-d", "--build"]);

  console.log("[2/3] 서버가 뜰 때까지 기다립니다…");
  const healthy = await waitForHealth(`http://localhost:${serverPort}/health`);
  if (!healthy) {
    console.error("서버가 60초 안에 뜨지 않았습니다. `docker compose logs`로 확인해주세요.");
    process.exit(1);
  }

  console.log("[3/3] DB 스키마를 동기화합니다 (이미 최신이면 아무 일도 안 일어남)…");
  run("pnpm", ["--filter", "@ai-crew/server", "exec", "prisma", "db", "push"], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });

  console.log("\n서버/웹/DB는 백그라운드에서 계속 떠 있습니다.");
  console.log("내리고 싶으면: docker compose -f infra/docker-compose.yml down\n");
  console.log("이제 러너를 포그라운드로 실행합니다 (Ctrl+C로 러너만 멈춥니다. docker는 안 내려감).\n");

  // 러너는 계속 실행되는 프로세스라 여기서부터는 이 스크립트가 곧 러너다 (exec처럼 인계).
  const runner = spawn("pnpm", ["--filter", "@ai-crew/runner", "dev"], {
    stdio: "inherit",
    cwd: REPO_ROOT,
  });
  runner.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
