# ai-crew

Claude Code가 **팀장**을 맡고, Claude/Antigravity/Codex CLI가 **직원**을 맡는 AI 개발팀 오케스트레이터.
사용자가 팀장에게 한 번 요청하면 작업을 쪼개 적합한 직원에게 티켓으로 위임하고, 웹 조직도에서 실시간
진행 상황을 보고 개입할 수 있다.

## 목적

여러 프로젝트를 동시에 굴릴 때, 사람이 매번 "이번엔 어느 프로젝트를 누가 작업하지"를 직접 챙기는 대신
실제 회사 조직처럼 **팀장 1명이 위임하고 여러 직원이 각자 담당 프로젝트에서 병렬로 작업**하게 만든다.

- 팀장/직원 모두 API 과금이 아니라 **CLI 구독 요금제**로 돈다 (Claude Max, ChatGPT Plus/Pro 등).
- 직원은 격리된 브랜치가 아니라 **프로젝트 실제 폴더에서 직접 커밋**한다 — 별도 병합 과정이 없다.
- 담당 밖의 일이 필요하면(`blocked`) 팀장이 자동으로 깨어나 다른 직원에게 새 티켓을 발행하고,
  완료되면 원래 작업이 자동으로 재개된다.

자세한 설계 배경은 [`docs/PLAN.md`](./docs/PLAN.md) 참고.

## 아키텍처

```mermaid
flowchart TB
  User(("사용자")) --> Caddy

  subgraph Docker["Docker Compose"]
    Caddy["Caddy :80/:443"] --> Web["apps/web\nReact + Vite"]
    Caddy --> Server["apps/server\nFastify API + WebSocket + Prisma"]
    Server --> DB[("Postgres + pgvector\n(티켓/직원/팀 기억)")]
  end

  subgraph Host["호스트 프로세스 (Docker 밖)"]
    Runner["runner\nCLI 오케스트레이션"]
  end

  Server <-. WebSocket .-> Runner
  Runner -->|spawn| Claude["claude CLI"]
  Runner -->|spawn| Agy["agy (Antigravity) CLI"]
  Runner -->|spawn| Codex["codex CLI"]
  Claude & Agy & Codex --> Projects[("실제 프로젝트 폴더\nWORKSPACE_ROOT")]
```

| 컴포넌트 | 역할 | 실행 위치 |
|---|---|---|
| `apps/web` | 조직도 UI (React) — 팀/직원 관리, 티켓 상태, 팀장 채팅 | Docker |
| `apps/server` | Fastify REST API + WebSocket + Prisma. 티켓 상태머신, MCP 서버(팀장/직원용 툴) | Docker |
| `infra` | `docker-compose.yml`(postgres/server/web/caddy) + `Caddyfile` | - |
| **`runner`** | **claude/agy/codex CLI를 실제로 `spawn`하는 유일한 프로세스** | **호스트(Docker 밖)** |
| `packages/shared` | 서버·웹·러너가 공유하는 티켓/이벤트/모델 타입 | - |
| `agents/manager.md` | 팀장 시스템 프롬프트 (모든 팀이 공유) | - |

**서버/DB/웹은 Docker, 러너만 호스트에서 직접 돈다.** 러너가 실행하는 CLI들이 실제 프로젝트의
JDK/Gradle/Node/Go 툴체인, git, 그리고 사용자가 로그인해둔 CLI 세션을 그대로 써야 하기 때문에
컨테이너로 격리할 수 없다. 서버와 러너는 WebSocket으로 붙어 티켓 배정/진행 이벤트를 주고받는다.

## 빠른 시작

```bash
git clone https://github.com/SangkiHan/ai-crew.git
cd ai-crew
pnpm install
pnpm start
```

`pnpm start` 하나로 아래가 순서대로, **전부 백그라운드로** 진행된다 (터미널을 붙잡고 있을 필요 없음):

1. `.env`가 없으면 `scripts/setup.mjs`가 AI 직원들이 작업할 프로젝트 폴더(`WORKSPACE_ROOT`)를 물어보고
   `.env`를 만든다. **직접 채워야 하는 절대경로는 이것 하나뿐이다.**
2. `docker compose up -d --build`로 postgres/server/web/caddy를 띄운다.
3. 서버가 `/health`에 응답할 때까지 최대 60초 대기.
4. `prisma db push`로 DB 스키마 동기화 (여러 번 실행해도 안전).
5. 러너(`pnpm --filter @ai-crew/runner dev`)를 detached로 띄운다. 로그는 `.run/runner.log`,
   pid는 `.run/runner.pid`.

```bash
tail -f .run/runner.log   # 러너 로그 실시간으로 보기
pnpm stop                 # 러너 + docker 전부 내리기 (DB는 volume에 남음)
```

브라우저에서 `http://localhost` 접속 → **"직원 관리"**로 직원을 추가하고, 채팅창에 팀장에게 할 일을
말하면 된다.

**Windows/macOS 어디서나 동작한다** — 경로 계산에 `os.homedir()`/`path.join`만 쓰고, 셸을 거치지 않는
`execFile`/`spawn`만 쓴다. 다만 `claude`/`agy`/`codex` CLI와 실제 프로젝트의 툴체인(JDK/Node/Go 등)은
그 운영체제에 미리 설치·로그인되어 있어야 한다 (아래 "AI 모델 CLI 설치" 참고).

> 단계를 손으로 하나씩 실행하고 싶으면(디버깅 등) 맨 아래 "로컬 실행 (자세히)" 참고.

## 핵심 개념

### 팀 — 여러 개 만들 수 있다

헤더의 팀 선택 드롭다운(**"+ 새 팀"**)에서 자유롭게 추가/삭제한다. 팀마다 **직원 명단·팀장 대화
세션·채팅 기록**이 완전히 독립적이다. 팀장의 시스템 프롬프트(`agents/manager.md`)는 모든 팀이
공유하고, 보는 직원/티켓의 범위만 팀별로 분리된다.

### 팀장

- Claude Code(Claude Max 구독) 고정. 팀마다 독립된 세션으로 여러 개 동시에 돌릴 수 있다.
- 사용자 요청을 작업 단위로 쪼개 적합한 직원에게 위임하고 진행 상황을 확인한다 — **직접 코드를
  만지지 않는다.**
- `list_projects`, `list_employees`, `create_ticket`, `get_ticket`, `list_tickets`, `ask_user` MCP
  툴로 지시한다.

### 직원 — 웹에서 추가/삭제, 이름으로 여러 명

**"직원 관리"**에서 추가하며, 각 직원마다 이름 / AI 모델(Claude Code · Antigravity · Codex 중 하나) /
담당 업무(자유 텍스트) / 담당 프로젝트(체크박스, 비우면 팀 전체 담당)를 정한다. 담당 업무 설명이 곧
그 직원의 정의라 고정된 역할 목록이 없고, 특정 언어/프레임워크에도 고정되지 않는다 — 작업 전에
대상 프로젝트의 실제 빌드 파일을 보고 스택을 파악한다. 추가 즉시(러너 재시작 없이) 다음 티켓부터
반영된다.

### 티켓 — 팀장과 직원이 소통하는 작업 단위

```
queued(대기) → assigned(배정) → running(작업중) ─┬→ review(검수, 자동으로 done) → done(완료)
                                                 ├→ blocked(막힘) → 팀장이 다른 직원에게 새 티켓 발행
                                                 ├→ needs_approval → 위험한 명령이라 사용자 승인 대기
                                                 └→ failed(실패)
```

- **`blocked`가 핵심이다.** 직원이 담당 밖의 일이 필요하면 `report_blocked`로 팀장에게 보고 →
  팀장이 자동으로 깨어나 다른 직원에게 `parentTicketId`를 건 새 티켓 발행 → 그 티켓이 끝나면 막혀있던
  원래 티켓이 자동 재개된다.
- **사소한 건 직원끼리 직접 묻는다.** `ask_peer`로 동료에게 비동기 질문을 남기고, 답을 기다리지 않고
  하던 작업을 계속한다.
- 직원은 프로젝트 실제 폴더의 현재 브랜치에 직접 작업·커밋한다. `review`는 승인 버튼이 아니라 곧장
  `done`으로 넘어가는 경유지다 — 이미 커밋까지 끝난 상태라 사람은 보고를 읽고 필요하면 "수정 요청"으로
  같은 세션을 이어서(`--resume`, claude만 지원) 후속 지시를 내린다.
- `git push`처럼 위험한 명령은 직원의 `requireApproval` 목록에 있으면 실행 전에 막힌다 (claude는
  `--disallowedTools`로 확실히 차단, antigravity/codex는 정책 엔진 한계로 best-effort).

### 프로젝트

`WORKSPACE_ROOT`(`.env`) 아래 폴더는 매번 스캔해서 자동으로 잡힌다. `WORKSPACE_ROOT` 밖의 임의
절대경로도 팀장에게 알려주면 그대로 작업 대상으로 쓸 수 있다.

## AI 모델 CLI 설치

직원 추가 화면에서 각 모델 옆에 **설치됨/설치 안 됨**이 표시된다 (러너가 실행 중인 컴퓨터의 PATH를
확인). 로그인 여부까지는 자동 확인이 안 되므로, 설치 후 최초 실행해서 직접 로그인해야 한다.

```bash
npm install -g @anthropic-ai/claude-code && claude   # Claude Code
irm https://antigravity.google/cli/install.ps1 | iex; agy   # Antigravity (Windows). npm 패키지 아님
npm install -g @openai/codex && codex login           # Codex
```

로그인이 잘못됐거나 그 CLI의 요금제/모델이 안 맞으면 실제로 티켓을 실행할 때 실패 로그로 나타난다 —
설치 확인은 "켜져 있나"만 보고, 동작 여부는 한 번 시켜봐야 확실하다.

**알려진 이슈** (실제로 겪고 고친 것들):

- **Antigravity/Codex의 모델 이름은 CLI 버전에 따라 자주 바뀐다.** `packages/shared/src/models.ts`의
  `DRIVER_MODEL_OPTIONS`가 옛 이름을 들고 있으면 `--model` 지정 시 즉시 실패한다. `agy models`로
  현재 유효한 이름을 다시 확인해서 맞춰야 한다.
- **ChatGPT 계정으로 로그인한 Codex는 일부 모델 이름을 거부한다** (`"model is not supported when
  using Codex with a ChatGPT account"`). 실제로 어떤 모델이 통과하는지는 계정마다 달라 직접
  `codex exec "..." -m <모델>`로 확인이 필요하다.
- **Windows에서 Codex에 여러 줄 프롬프트를 인자로 넘기면 안 된다.** npm이 Windows에 만드는
  `codex.cmd` 배치 셸을 통해 실행되는데, 개행이 포함된 긴 인자를 넘기면 `cmd.exe`가 인자 경계를
  잘못 인식해 뒤에 오는 플래그가 통째로 무시된다. `runner/src/drivers/codex.ts`는 이 때문에 프롬프트를
  인자 대신 stdin으로 넘긴다 (`codex exec`가 공식 지원하는 방식이라 모든 OS에서 안전하다).
- **Antigravity/Codex의 위험 명령 차단은 best-effort다.** Claude처럼 `--disallowedTools`로 확실히
  막을 수단이 없다.
- **macOS에서 `EPERM`으로 막히면 Full Disk Access 문제다.** `System Settings → Privacy & Security →
  Full Disk Access`에서 러너를 실행할 터미널 앱에 권한을 켜준다 (`~/Desktop` 등은 macOS가 보호하는
  폴더라 스캔/실행 권한이 별도로 필요하다).

## 인프라 자동화 (선택, 기본 꺼짐)

API/CLI가 없는 인프라 콘솔(도메인 등록업체, 클라우드 대시보드 등)을 팀장이 브라우저로 직접 조작하는
기능. 설계 배경은 [`docs/INFRA_MANAGER_PLAN.md`](./docs/INFRA_MANAGER_PLAN.md) 참고. 직원에게
위임하지 않고 **팀장이 직접**, 사용자가 지켜보는 채팅 세션 안에서 진행한다.

```bash
# .env
INFRA_BROWSER_ENABLED=true
INFRA_BROWSER_CDP_ENDPOINT=http://localhost:9222   # 생략 시 기본값
```

1. `npx playwright install chromium` (최초 1회).
2. 원격 디버깅 포트를 연 크롬을 직접 띄운다 (전용 프로필 권장):
   ```bash
   # Windows
   chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\ai-crew-infra-profile"
   # macOS
   open -a "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir="$HOME/ai-crew-infra-profile"
   ```
3. 그 크롬으로 필요한 사이트에 로그인·이동해두고, 팀장에게 "지금 열어둔 화면에서 이어서 해줘"라고
   지시한다.

상태를 바꾸는 조작(저장·등록·발급·배포·삭제)은 반드시 먼저 채팅으로 설명하고 사용자가 승인해야
실행된다 (`agents/manager.md`). **`claude` 드라이버 팀장에서만 지원** — antigravity/codex는 MCP 툴을
개별 화이트리스트할 방법이 없어 위험 툴까지 전부 열리기 때문이다.

## 로컬 실행 (자세히)

`pnpm start`(`scripts/start.mjs`)가 자동으로 하는 걸 한 단계씩 직접 실행하고 싶을 때:

```bash
node scripts/setup.mjs   # 최초 1회 - WORKSPACE_ROOT를 물어보고 .env 생성
docker compose -f infra/docker-compose.yml up -d --build
curl localhost:8080/health

# 최초 1회: DB 테이블 생성
DATABASE_URL="postgresql://aicrew:aicrew@localhost:5432/aicrew" \
  pnpm --filter @ai-crew/server exec prisma db push --accept-data-loss

# 러너는 팀장/직원 MCP 서버를 apps/server/dist/mcp/*.js로 직접 스폰한다 - 도커 이미지 안이 아니라
# 호스트 파일시스템의 dist라서, 호스트에서도 한 번 빌드해둬야 한다 (빠뜨리면 MCP 툴이 하나도
# 없는 채로 조용히 동작한다).
pnpm --filter @ai-crew/shared build
pnpm --filter @ai-crew/server build

# 러너는 호스트에서 직접 실행 (컨테이너 아님 - JDK/Gradle/git/CLI를 그대로 써야 함)
pnpm --filter @ai-crew/runner dev
```

내릴 때: 러너 프로세스 종료(`Ctrl+C`) 후 `docker compose -f infra/docker-compose.yml down`
(`pnpm stop`이 자동으로 해준다).

팀장을 CLI로 직접 불러서 테스트:

```bash
pnpm --filter @ai-crew/server build
pnpm --filter @ai-crew/runner manager "puppynote-server에 헬스체크 엔드포인트 추가해줘"
```

세션 id는 `~/.ai-crew/manager-session.json`에 저장되고 다음 호출부터 자동으로 이어진다 (지우면 새로
시작).

직원을 만들고 티켓을 던져서 파이프라인이 도는지 확인:

```bash
curl -X POST localhost:8080/api/employees -H "Content-Type: application/json" -d \
  '{"name":"백엔드-테스트","driver":"claude","taskDescription":"puppynote-server 백엔드 담당"}'
curl -X POST localhost:8080/api/tickets -H "Content-Type: application/json" \
  -d '{"role":"백엔드-테스트","project":"puppynote-server","title":"test","spec":"just testing"}'
curl localhost:8080/api/tickets
```

## 개발

```bash
pnpm install
pnpm dev:server   # apps/server
pnpm dev:web      # apps/web
pnpm dev:runner   # runner (호스트에서 직접 실행, 컨테이너 아님)
```

상세 변경 이력과 설계 결정은 `git log`와 [`docs/PLAN.md`](./docs/PLAN.md)를 참고.
