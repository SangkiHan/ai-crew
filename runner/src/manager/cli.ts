import { invokeManager } from "./invoke.js";

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
