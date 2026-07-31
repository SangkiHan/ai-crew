// tsx watch(o)/일반 tsx(o) 둘 다 정상이었으니, 남은 유일한 차이는 "웹소켓 연결이 켜져
// 있는 상태에서 spawn하는가"다. 실제 러너(index.ts)와 똑같이 서버에 WS로 연결해두고,
// 그 상태에서 invokeManager를 호출해본다. 티켓 큐/드라이버 로직은 전혀 없다 - 순수하게
// "WS 연결 유무"만 변수로 남긴다.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(REPO_ROOT, ".env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const SERVER_WS_URL = process.env.SERVER_WS_URL ?? "ws://localhost:8080/ws/runner";

const ws = new WebSocket(SERVER_WS_URL);
await new Promise<void>((resolve, reject) => {
  ws.on("open", () => {
    console.log("[debug] ws 연결됨:", SERVER_WS_URL);
    resolve();
  });
  ws.on("error", reject);
});

const { invokeManager } = await import("./src/manager/invoke.js");

const [teamId, ...rest] = process.argv.slice(2);
const message = rest.join(" ");
if (!teamId || !message) {
  console.error('usage: npx tsx debug-ws-invoke.ts <teamId> "<메시지>"');
  process.exit(1);
}

const result = await invokeManager(teamId, message, (line) => console.log(line));
console.log("\nsession:", result.sessionId, "| success:", result.success);
console.log("\n--- result ---\n");
console.log(result.resultText);

ws.close();
process.exit(result.success ? 0 : 1);
