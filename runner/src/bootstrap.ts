// .env는 여기서 먼저 읽어야 한다. index.ts를 최상단에서 바로 import하면 ESM은 import를
// 호이스팅해버려서, index.ts(그리고 그게 import하는 workspace.ts 등)의 최상위 코드가
// process.env를 읽는 시점이 이 파일의 나머지 코드보다 먼저 실행돼버린다 - 그래서 동적 import로
// 실제 로직을 미룬다.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const envPath = join(REPO_ROOT, ".env");

if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

await import("./index.js");
