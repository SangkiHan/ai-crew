// 지금까지 유일하게 테스트 안 해본 차이: 실제 index.ts는 "ws.on('message', ...)" 콜백
// 안에서 invokeManager를 호출한다 (서버가 보낸 이벤트에 반응). 지금까지의 테스트는 전부
// 스크립트가 직접(top-level에서) invokeManager를 불렀다. 이 스크립트는 실제 서버가 보내는
// invoke_manager 이벤트를 웹소켓으로 받아서 그 콜백 안에서 호출하도록 만든다 - index.ts의
// 그 부분만 그대로 재현.
//
// 사용법:
//   1) 실제 러너(tsx watch src/bootstrap.ts)는 꺼둔다 (Ctrl+C) - 서버가 이 스크립트에게
//      이벤트를 보내게 하려면 이게 유일하게 연결된 "러너"여야 한다.
//   2) node/tsx로 이 스크립트를 실행하고 연결될 때까지 기다린다.
//   3) 웹 UI에서 팀장에게 메시지를 보낸다.
//   4) 이 터미널에 뭐가 찍히는지 확인한다.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import spawn from "cross-spawn";
import WebSocket from "ws";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(REPO_ROOT, ".env");
if (existsSync(envPath)) process.loadEnvFile(envPath);

const SERVER_WS_URL = process.env.SERVER_WS_URL ?? "ws://localhost:8080/ws/runner";
const { invokeManager } = await import("./src/manager/invoke.js");

// index.ts가 시작할 때 실제로 하는 것과 똑같이, claude --version / --help를 진단용으로
// 먼저 두 번 spawn해본다 - 남은 유일한 미검증 차이. 이게 원인이면 이 스크립트도 이제 깨질 것.
function logClaudeDiagnosticsLikeIndexTs() {
  const versionCheck = spawn("claude", ["--version"]);
  let versionOut = "";
  versionCheck.stdout?.on("data", (c: Buffer) => (versionOut += c.toString()));
  versionCheck.on("close", () => {
    const helpCheck = spawn("claude", ["--help"]);
    let helpOut = "";
    helpCheck.stdout?.on("data", (c: Buffer) => (helpOut += c.toString()));
    helpCheck.on("close", () => {
      console.log(`[debug] claude 진단 완료: version=${versionOut.trim()}, help 길이=${helpOut.length}`);
    });
  });
}
logClaudeDiagnosticsLikeIndexTs();

const ws = new WebSocket(SERVER_WS_URL);

ws.on("open", () => {
  console.log("[debug] ws 연결됨:", SERVER_WS_URL);
  console.log("[debug] 이제 웹 UI에서 팀장에게 메시지를 보내보세요 (실제 러너는 꺼둔 상태여야 합니다)");
});

ws.on("message", async (raw: Buffer) => {
  const event = JSON.parse(raw.toString());
  console.log("[debug] 이벤트 수신:", event.type);
  if (event.type !== "invoke_manager") return;

  const result = await invokeManager(event.teamId, event.message, (line) => console.log(line));
  console.log("\nsession:", result.sessionId, "| success:", result.success);
  console.log("--- result ---");
  console.log(result.resultText);

  // 서버의 busyTeams를 정상적으로 풀어주기 위해 실제 프로토콜대로 결과를 돌려보낸다.
  ws.send(
    JSON.stringify({
      type: "manager_result",
      teamId: event.teamId,
      requestId: event.requestId,
      resultText: result.resultText,
      success: result.success,
    })
  );

  process.exit(result.success ? 0 : 1);
});

ws.on("error", (err) => console.error("[debug] ws error:", err));
