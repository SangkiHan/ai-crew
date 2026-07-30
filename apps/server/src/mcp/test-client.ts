// claude CLI 없이 MCP 서버(apps/server/dist/mcp/server.js)를 직접 stdio로 띄워
// 5개 툴이 실제로 동작하는지 확인하는 개발용 스크립트. `pnpm --filter @ai-crew/server mcp:test`
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const SERVER_ENTRY = join(REPO_ROOT, "apps", "server", "dist", "mcp", "server.js");

async function main() {
  const transport = new StdioClientTransport({
    command: "node",
    args: [SERVER_ENTRY],
    env: {
      AI_CREW_SERVER_URL: "http://localhost:8080",
      WORKSPACE_ROOT: join(process.env.HOME ?? "", "Desktop/Project"),
    },
  });

  const client = new Client({ name: "manual-test-client", version: "0.0.0" });
  await client.connect(transport);

  const tools = await client.listTools();
  console.log(
    "=== tools ===",
    tools.tools.map((t) => t.name)
  );

  const projects = await client.callTool({ name: "list_projects", arguments: {} });
  console.log("\n=== list_projects ===\n", (projects.content as any)[0].text);

  const created = await client.callTool({
    name: "create_ticket",
    arguments: {
      role: "backend",
      project: "puppynote-server",
      title: "mcp manual test",
      spec: "verifying MCP tools directly without the claude CLI",
    },
  });
  console.log("\n=== create_ticket ===\n", (created.content as any)[0].text);
  const ticketId = JSON.parse((created.content as any)[0].text).id;

  const fetched = await client.callTool({ name: "get_ticket", arguments: { id: ticketId } });
  console.log("\n=== get_ticket ===\n", (fetched.content as any)[0].text);

  const listed = await client.callTool({ name: "list_tickets", arguments: {} });
  console.log("\n=== list_tickets ===\n", (listed.content as any)[0].text);

  const asked = await client.callTool({
    name: "ask_user",
    arguments: { question: "이거 진짜 되는거 맞아?" },
  });
  console.log("\n=== ask_user ===\n", (asked.content as any)[0].text);

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
