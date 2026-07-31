// 임시 디버그 스크립트 - 러너 전체(WS/서버 연결)를 거치지 않고, 러너가 실제로 쓰는
// cross-spawn으로 claude를 똑같이 spawn만 해본다. 이걸로 재현되면 cross-spawn 쪽 문제,
// 안 되면(파워셸 직접 실행처럼 정상) 러너의 다른 부분(env, cwd 등)이 원인이다.
// 실행: node scripts/debug-spawn.mjs  (ai-crew 레포 루트에서)
import spawn from "cross-spawn";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
