# ai-crew

팀장(Claude Code) + 직원(Claude/Gemini/Codex CLI)으로 구성된 AI 팀. 사용자가 팀장에게 한 번 요청하면
작업을 분해해 적합한 직원에게 티켓으로 위임하고, 조직도 UI에서 실시간 진행 상황을 보고 개입할 수 있다.

자세한 배경과 단계별 계획은 [`docs/PLAN.md`](./docs/PLAN.md) 참고.

## 로컬 실행

```bash
cp .env.example .env   # WORKSPACE_ROOT 등 값 확인/수정
docker compose -f infra/docker-compose.yml up -d
curl localhost:8080/health
```

## 개발

```bash
pnpm install
pnpm dev:server   # apps/server
pnpm dev:web      # apps/web
pnpm dev:runner   # runner (호스트에서 직접 실행, 컨테이너 아님)
```
