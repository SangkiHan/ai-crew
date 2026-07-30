# ai-crew

팀장(Claude Code) + 직원(Claude/Gemini/Codex CLI)으로 구성된 AI 팀. 사용자가 팀장에게 한 번 요청하면
작업을 분해해 적합한 직원에게 티켓으로 위임하고, 조직도 UI에서 실시간 진행 상황을 보고 개입할 수 있다.

자세한 배경과 단계별 계획은 [`docs/PLAN.md`](./docs/PLAN.md) 참고.

## AI 팀 구성

실제 회사 조직처럼 **팀장 1명 + 직원 여러 명**으로 구성된다. 팀장과 직원 모두 각자의 CLI 세션으로
동작하며(API 과금 없이 구독 요금제로 돈다), 마크다운 파일 하나로 정의된다.

### 팀장

- **누가**: Claude Code (Claude Max 구독)
- **무엇을 하나**: 사용자 요청을 작업 단위로 쪼개고, 어떤 직원에게 맡길지 정하고, 끝난 작업의 diff를
  검수한다. **팀장은 직접 코드를 만지지 않는다** — 오직 분해·위임·검수만 한다.
- **어떻게 지시하나**: `list_projects`, `create_ticket`, `get_ticket`, `list_tickets`, `ask_user` 라는
  5개의 MCP 툴로 직원에게 일을 맡기고 진행 상황을 확인한다 (`agents/manager.md`에 행동 규칙이 적혀 있음).

### 직원

각 직원은 `agents/*.md` 파일 하나로 정의된다. **파일 하나 추가 = 직원 한 명 추가**이고 서버/코드를
고칠 필요가 없다. 지금 정의돼 있는 직원:

| 직원 | 담당 CLI | 담당 프로젝트 (`~/Desktop/Project/` 하위) | 정의 파일 |
|---|---|---|---|
| 백엔드 직원 | Claude Code | `addiction`, `puppynote-server`, `quitmate-admin-server` (Spring Boot/Gradle) | `agents/backend.md` |
| 프론트 직원 | Gemini CLI | `addiction-front-app`, `addiction-front-native`, `puppynote-front-app`, `quitmate-admin-front` (React/React Native) | `agents/frontend.md` |
| (예정) 서류 직원 | Codex CLI | 문서/기획류 작업 | 6단계에서 추가 예정 |

### 협업 방식 — 티켓

팀장과 직원은 **티켓**이라는 작업 단위로 소통한다 (사람 회사의 지라 티켓과 비슷하다고 생각하면 된다).

```
사용자 → 팀장 : "puppynote-server에 헬스체크 추가해줘"
팀장   → 백엔드 직원 : 티켓 발행 (역할/프로젝트/제목/구체적 작업지시)
```

티켓은 다음 상태를 오간다:

```
queued(대기) → assigned(배정) → running(작업중) ─┬→ review(검수) → done(완료)
                                                 ├→ blocked(막힘)   → 팀장이 다른 직원에게 새 티켓 발행
                                                 ├→ needs_approval  → 위험한 명령이라 사용자 승인 대기
                                                 └→ failed(실패)
```

- **`blocked`가 핵심이다.** 예를 들어 프론트 직원이 작업하다가 백엔드 API가 없다는 걸 발견하면, 직접
  백엔드를 건드리지 않고 팀장에게 `blocked`로 보고한다. 팀장이 백엔드 직원에게 새 티켓을 발행해 문제를
  해결하면, 원래 막혔던 프론트 작업이 자동으로 재개된다. (이게 이 프로젝트를 만드는 이유다.)
- 직원은 실제 프로젝트 폴더를 직접 건드리지 않고 **git worktree**라는 격리된 작업 공간에서만 일한다 —
  메인 브랜치가 안전하게 보호된다.
- `git push`처럼 위험한 명령은 직원 정의 파일의 `requireApproval` 목록에 있으면 실행 전 UI로 사용자
  승인을 받는다.

### 지금까지 실제로 만들어진 것

- **0단계 (완료)**: 서버·DB·조직도 UI 골격. `docker compose up` 하면 4개 컨테이너(서버/웹/DB/Caddy)가
  뜨고 `/health`가 응답한다.
- **1단계 (완료)**: 티켓 CRUD + 상태머신 + 러너 WS 채널을, 실제 Claude/Gemini 대신 **가짜 직원(mock
  드라이버)**으로 검증했다. 확인된 것: 티켓을 여러 개 동시에 던지면 정해진 동시 실행 수(기본 2개)만큼만
  병렬로 처리하고 나머지는 큐에서 대기하며, 러너 프로세스가 죽었다 재시작해도 `running` 상태였던 티켓을
  이어받아 끝까지 완료한다.
- **2단계 (완료)**: 팀장에게 물릴 MCP 툴 5개(`list_projects`, `create_ticket`, `get_ticket`,
  `list_tickets`, `ask_user`)와, `claude -p` 헤드리스 프로세스를 스폰해 세션을 `--resume`으로 이어가는
  러너 쪽 매니저 호출기(`runner/src/manager/`)를 구현했다. `create_ticket`/`get_ticket`/`list_tickets`/
  `ask_user`는 MCP 클라이언트로 직접 호출해 정상 동작을 확인했다.
- **아직 안 된 것**: 직원이 실제 코드를 고치는 것(3단계), 조직도 UI(4단계), 외부 접속(5단계),
  Gemini/Codex 직원 연결(6단계).

### 알려진 이슈 — macOS 폴더 권한 (Full Disk Access 필요)

`list_projects`가 `WORKSPACE_ROOT`(`~/Desktop/Project`)를 스캔하려고 `fs.readdir`를 호출하면
macOS의 TCC(개인정보 보호) 정책 때문에 **Node.js가 `EPERM: operation not permitted, scandir`로
막힌다.** `~/Desktop`, `~/Documents`, `~/Downloads`는 macOS가 특별히 보호하는 폴더라, 그 안의 내용을
읽으려는 앱은 권한을 받아야 한다 (같은 코드로 `~/ai-crew`처럼 Desktop 밖의 폴더를 스캔하면 문제없이 된다).

실제로 러너를 상시 구동시키기 전에, **`System Settings → Privacy & Security → Full Disk Access`에서
러너를 실행할 앱(터미널 앱, 또는 `node` 바이너리)에 권한을 켜줘야 한다.** 이걸 안 하면 `list_projects`뿐
아니라 3단계의 git worktree 생성·빌드 실행도 같은 벽에 부딪힐 가능성이 높다.

## 로컬 실행

```bash
cp .env.example .env   # WORKSPACE_ROOT 등 값 확인/수정
docker compose -f infra/docker-compose.yml up -d --build
curl localhost:8080/health

# 최초 1회: DB에 Ticket 테이블 생성 (postgres 컨테이너가 뜬 뒤에)
DATABASE_URL="postgresql://aicrew:aicrew@localhost:5432/aicrew" \
  pnpm --filter @ai-crew/server exec prisma db push

# 러너는 호스트에서 직접 실행 (컨테이너 아님 - JDK/Node 툴체인을 그대로 써야 하므로)
pnpm --filter @ai-crew/runner dev
```

팀장을 직접 불러서 테스트 (별도 터미널에서, `apps/server` 빌드가 먼저 되어 있어야 `mcp/server.js`가 존재함):

```bash
pnpm --filter @ai-crew/server build
pnpm --filter @ai-crew/runner manager "puppynote-server에 헬스체크 엔드포인트 추가해줘"
```

세션 id는 `~/.ai-crew/manager-session.json`에 저장되고, 다음 호출부터는 자동으로 `--resume`으로
이어진다 (대화가 끊기지 않음). 새로 시작하고 싶으면 그 파일을 지우면 된다.

`claude` CLI 없이 MCP 툴 5개만 따로 확인하고 싶으면:

```bash
pnpm --filter @ai-crew/server mcp:test
```

티켓을 만들어 파이프라인이 도는지 확인:

```bash
curl -X POST localhost:8080/tickets -H "Content-Type: application/json" \
  -d '{"role":"backend","project":"puppynote-server","title":"test","spec":"just testing"}'
curl localhost:8080/tickets
```

## 개발

```bash
pnpm install
pnpm dev:server   # apps/server
pnpm dev:web      # apps/web
pnpm dev:runner   # runner (호스트에서 직접 실행, 컨테이너 아님)
```
