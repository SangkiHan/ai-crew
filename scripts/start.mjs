#!/usr/bin/env node
// 한 번에 다 띄우는 스크립트: docker compose(서버/웹/DB/Caddy) + DB 스키마 동기화 + 러너(호스트).
// 러너는 git worktree/JDK/Gradle/claude·gemini·codex CLI가 필요해서 컨테이너 안에 넣을 수 없다 -
// 그래서 docker와 러너 둘 다 백그라운드(detached)로 띄우고 이 스크립트는 바로 끝난다.
// 로그는 .run/runner.log에 쌓이고, 끄고 싶을 때는 `pnpm stop` 하나면 된다 (scripts/stop.mjs).
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const COMPOSE_FILE = join(REPO_ROOT, "infra", "docker-compose.yml");
const ENV_PATH = join(REPO_ROOT, ".env");
const RUN_DIR = join(REPO_ROOT, ".run");
const RUNNER_PID_FILE = join(RUN_DIR, "runner.pid");
const RUNNER_LOG_FILE = join(RUN_DIR, "runner.log");
const IS_WINDOWS = process.platform === "win32";

function readEnvValue(key, fallback) {
  if (!existsSync(ENV_PATH)) return fallback;
  const match = readFileSync(ENV_PATH, "utf-8").match(new RegExp(`^${key}=(.*)$`, "m"));
  return match ? match[1].trim() : fallback;
}

function run(cmd, args, opts = {}) {
  // Windows에서 pnpm은 실제 실행파일이 아니라 .cmd 스크립트라서 shell: true 없이는
  // spawn 자체가 안 되고 status가 null로 조용히 죽는다 (docker.exe는 진짜 바이너리라 문제없음).
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    cwd: REPO_ROOT,
    shell: IS_WINDOWS && cmd === "pnpm",
    ...opts,
  });
  if (result.error) {
    throw new Error(`${cmd} ${args.join(" ")} 실행 실패: ${result.error.message}`);
  }
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

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!existsSync(ENV_PATH)) {
    console.log(".env가 없습니다. 먼저 설정을 진행합니다.\n");
    run(process.execPath, [join(REPO_ROOT, "scripts", "setup.mjs")], {
      env: { ...process.env, AI_CREW_SKIP_SETUP_HINT: "1" },
    });
    console.log();
  }

  const dockerInfo = spawnSync("docker", ["info"], { stdio: "ignore", cwd: REPO_ROOT });
  if (dockerInfo.status !== 0) {
    console.error(
      "Docker에 연결할 수 없습니다. Docker Desktop이 실행 중인지 확인해주세요 " +
        "(트레이의 고래 아이콘이 완전히 켜질 때까지 기다린 뒤 다시 실행)."
    );
    process.exit(1);
  }

  mkdirSync(RUN_DIR, { recursive: true });

  if (existsSync(RUNNER_PID_FILE)) {
    const existingPid = Number(readFileSync(RUNNER_PID_FILE, "utf-8").trim());
    if (existingPid && isRunning(existingPid)) {
      console.log(`러너가 이미 실행 중입니다 (pid ${existingPid}). 중복 실행을 막기 위해 종료합니다.`);
      console.log("재시작하려면 먼저 `pnpm stop`으로 내려주세요.");
      process.exit(1);
    }
  }

  const serverPort = readEnvValue("SERVER_PORT", "8080");
  const databaseUrl =
    readEnvValue("DATABASE_URL", "postgresql://aicrew:aicrew@postgres:5432/aicrew").replace(
      "@postgres:",
      "@localhost:"
    ); // 호스트에서 psql 접속용으로 컨테이너 이름을 localhost로 바꿔치기

  console.log("[1/5] docker compose로 서버/웹/DB/Caddy를 띄웁니다…");
  run("docker", ["compose", "-f", COMPOSE_FILE, "up", "-d", "--build"]);

  console.log("[2/5] 서버가 뜰 때까지 기다립니다…");
  const healthy = await waitForHealth(`http://localhost:${serverPort}/health`);
  if (!healthy) {
    console.error("서버가 60초 안에 뜨지 않았습니다. `docker compose logs`로 확인해주세요.");
    process.exit(1);
  }

  console.log("[3/5] DB 스키마를 동기화합니다 (이미 최신이면 아무 일도 안 일어남)…");
  run("pnpm", ["--filter", "@ai-crew/server", "exec", "prisma", "db", "push"], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });

  // 러너(호스트 프로세스)는 팀장/직원 MCP 서버(apps/server/src/mcp/*.ts)를
  // `node apps/server/dist/mcp/*.js`로 직접 스폰한다 - 이건 도커 이미지 안의 dist가 아니라
  // 호스트 파일시스템의 dist를 가리킨다. 방금 위에서 한 `docker compose up --build`는 컨테이너
  // 안에만 dist를 만들어서, 이 호스트 build 없이는 이 dist가 아예 존재한 적이 없다 - 그러면
  // 러너가 MCP 서버를 스폰할 때 조용히 실패하고, 팀장이 list_projects/create_ticket 같은 툴을
  // 하나도 못 쓰는 채로 동작한다(겉으로는 정상 종료처럼 보여서 원인 파악이 매우 어렵다).
  console.log("[4/5] 러너가 로컬에서 쓸 MCP 서버(apps/server)를 호스트에도 빌드합니다…");
  run("pnpm", ["--filter", "@ai-crew/shared", "build"]);
  run("pnpm", ["--filter", "@ai-crew/server", "build"]);

  console.log("[5/5] 러너를 백그라운드로 띄웁니다…");
  const logFd = openSync(RUNNER_LOG_FILE, "a");
  const runner = spawn("pnpm", ["--filter", "@ai-crew/runner", "dev"], {
    cwd: REPO_ROOT,
    detached: true,
    shell: IS_WINDOWS,
    stdio: ["ignore", logFd, logFd],
  });
  if (runner.pid == null) {
    throw new Error("러너 프로세스를 시작하지 못했습니다 (pid 없음).");
  }
  writeFileSync(RUNNER_PID_FILE, String(runner.pid));
  runner.unref();

  console.log("\n모든 서비스가 백그라운드에서 떠 있습니다 (docker: server/web/postgres/caddy, 호스트: 러너).");
  console.log(`러너 로그 보기: tail -f ${RUNNER_LOG_FILE}`);
  console.log("전부 내리려면: pnpm stop\n");
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
