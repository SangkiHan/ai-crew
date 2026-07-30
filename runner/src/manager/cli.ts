// bootstrap.ts와 같은 이유로 .env 로딩을 동적 import보다 먼저 한다.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const envPath = join(REPO_ROOT, ".env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const { invokeManager } = await import("./invoke.js");

const message = process.argv.slice(2).join(" ");
if (!message) {
  console.error('usage: pnpm --filter @ai-crew/runner manager "<메시지>"');
  process.exit(1);
}

const result = await invokeManager(message, (line) => console.log(line));
console.log("\nsession:", result.sessionId, "| success:", result.success);
console.log("\n--- result ---\n");
console.log(result.resultText);
if (!result.success) process.exit(1);
