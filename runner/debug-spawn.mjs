// 임시 디버그 스크립트 - 러너 전체(WS/서버 연결)를 거치지 않고, 러너가 실제로 쓰는
// cross-spawn으로 claude를 똑같이 spawn만 해본다. 이걸로 재현되면 cross-spawn 쪽 문제,
// 안 되면(파워셸 직접 실행처럼 정상) 러너의 다른 부분(env, cwd 등)이 원인이다.
// 실행: node scripts/debug-spawn.mjs  (ai-crew 레포 루트에서)
import spawn from "cross-spawn";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// 실제 팀장 호출은 cwd가 ai-crew 레포 "루트"다 (이 스크립트가 있는 runner 폴더가 아니라
// 그 한 단계 위) - 지난 테스트는 runner 폴더에서 실행해서 이 차이를 아직 못 걸렀다.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(REPO_ROOT);

// 실제 러너(bootstrap.ts)는 claude를 스폰하기 전에 레포의 .env를 process.env로 로드한다 -
// 이 스크립트는 지금까지 그걸 안 했다. .env를 로드하면 cross-spawn이 기본으로 그 값들까지
// 전부 물려받은 채로 claude를 스폰하게 된다 - 이것도 같이 재현해본다.
const envPath = join(REPO_ROOT, ".env");
try {
  process.loadEnvFile(envPath);
  console.log(".env 로드됨:", envPath);
} catch (err) {
  console.log(".env 로드 실패(무시):", err.message);
}

const systemPromptFile = join(tmpdir(), "debug-system-prompt.txt");
writeFileSync(systemPromptFile, "당신은 테스트용 어시스턴트입니다.", "utf-8");

const args = [
  "-p",
  "1+1은 몇이야? 숫자만.",
  "--output-format",
  "stream-json",
  "--verbose",
  "--permission-mode",
  "dontAsk",
  "--allowedTools",
  "Read",
  "--append-system-prompt-file",
  systemPromptFile,
];

console.log("spawning with args:", JSON.stringify(args));
console.log("cwd:", process.cwd());

const child = spawn("claude", args, { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });

let stdout = "";
let stderr = "";
child.stdout.on("data", (c) => (stdout += c.toString()));
child.stderr.on("data", (c) => (stderr += c.toString()));
child.on("error", (err) => console.error("SPAWN ERROR:", err));
child.on("close", (code) => {
  console.log("--- exit code:", code, "---");
  console.log("--- STDOUT ---");
  console.log(stdout);
  console.log("--- STDERR ---");
  console.log(stderr);
});
