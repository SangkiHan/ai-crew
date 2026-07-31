# ai-crew

팀장(Claude Code) + 직원(Claude/Gemini/Codex CLI)으로 구성된 AI 팀. 사용자가 팀장에게 한 번 요청하면
작업을 분해해 적합한 직원에게 티켓으로 위임하고, 조직도 UI에서 실시간 진행 상황을 보고 개입할 수 있다.

자세한 배경과 단계별 계획은 [`docs/PLAN.md`](./docs/PLAN.md) 참고.

## 빠른 시작 (git clone 직후)

```bash
git clone https://github.com/SangkiHan/ai-crew.git
cd ai-crew
pnpm install
pnpm start
```

`pnpm start` 하나로 다음이 순서대로 자동 진행되고, **모든 서비스가 백그라운드로 뜬 뒤 명령이 바로
끝난다** (터미널을 계속 붙잡고 있지 않아도 됨):

1. `.env`가 없으면 먼저 `scripts/setup.mjs`를 실행해 AI 직원들이 작업할 프로젝트 폴더 경로
   (`WORKSPACE_ROOT`)를 물어보고 `.env`를 만든다.
2. `docker compose up -d --build`로 postgres/server/web/caddy 4개 컨테이너를 백그라운드로 띄운다.
3. 서버가 `/health`에 응답할 때까지 최대 60초 기다린다.
4. `prisma db push`로 DB 스키마를 동기화한다 (이미 최신이면 아무 일도 안 함 — 몇 번을 다시 실행해도
   안전하다).
5. 마지막으로 **러너**(`pnpm --filter @ai-crew/runner dev`)도 백그라운드(detached)로 띄운다. 로그는
   `.run/runner.log`에 쌓이고, pid는 `.run/runner.pid`에 기록된다.

```bash
tail -f .run/runner.log   # 러너 로그를 실시간으로 보고 싶을 때
```

이미 러너가 떠 있는 상태에서 `pnpm start`를 또 실행하면 중복 실행을 막기 위해 그냥 종료한다
(먼저 `pnpm stop`으로 내려야 다시 띄울 수 있다).

전부(러너 + docker) 한 번에 내리고 싶으면:

```bash
pnpm stop
```

`pnpm stop`은 러너 프로세스(자식 프로세스까지 전부)를 먼저 종료하고, 그다음
`docker compose down`으로 컨테이너를 내린다. DB는 volume에 남아있으니 데이터는 그대로 유지된다.
다시 시작할 때는 `pnpm start` 한 번이면 된다 (컨테이너 재빌드는 변경분만 캐시 없이 처리되므로
빠르다).

브라우저에서 `http://localhost` 접속 → 우측 상단 **"직원 관리"** 로 직원을 추가하고, 하단 채팅창에
팀장에게 할 일을 말하면 된다.

> 각 단계를 손으로 따로 실행하고 싶다면(디버깅 등) 아래 "로컬 실행 (자세히)"에 `pnpm start`가
> 내부적으로 하는 동작을 단계별 명령으로 풀어놓았다.

**절대경로를 직접 입력해야 하는 곳은 딱 하나, `.env`의 `WORKSPACE_ROOT`뿐이다** (`node scripts/setup.mjs`가
물어봐서 자동으로 채워준다. 나중에 바꾸고 싶으면 `.env` 파일을 직접 열어 수정). 그 외 포트/DB 접속 정보는
`infra/docker-compose.yml`에 이미 다 들어있어 손댈 필요가 없다.

**DB는 docker volume에 저장되므로 `docker compose down`으로 컨테이너를 내려도 데이터가 유지된다**
(`infra_aicrew-postgres` 볼륨). `docker compose down -v`처럼 `-v`를 주면 볼륨까지 지워지니 주의.

**맥/윈도우 어디서나 동작한다** — 절대경로 계산에 `os.homedir()`/`path.join`만 쓰고 셸을 거치지 않는
`execFile`/`spawn`만 쓴다. 다만 `claude`/`gemini`/`codex` CLI와 JDK/Node/Go 등 실제 툴체인은 그 운영체제에
설치돼 있어야 한다 (아래 "AI 모델(CLI) 설치 확인" 참고).

## AI 팀 구성

실제 회사 조직처럼 **팀장 1명 + 직원 여러 명**으로 구성된다. 팀장과 직원 모두 각자의 CLI 세션으로
동작하며(API 과금 없이 구독 요금제로 돈다), 웹 UI에서 관리한다.

### 팀 — 여러 개 만들 수 있다

헤더의 팀 선택 드롭다운(**"+ 새 팀"**)에서 팀을 자유롭게 추가/삭제할 수 있다. 팀마다 다음이
완전히 독립적이다:

- **직원 명단** — 이 팀에 속한 직원만 이 팀 팀장의 `list_employees`에 보이고, 이 팀 팀장만
  이 직원들에게 티켓을 만들 수 있다 (다른 팀 소속 직원 이름으로 시도하면 서버가 403으로 막는다).
- **팀장 대화 세션** — 팀마다 `--resume` 세션이 따로 유지된다. 한 팀의 팀장이 작업 중이어도
  다른 팀의 팀장에게는 동시에 말을 걸 수 있다.
- **채팅 기록** — 웹 UI에서 팀을 전환하면 그 팀의 대화만 보인다 (섞이지 않음).

팀장의 시스템 프롬프트(`agents/manager.md`)는 모든 팀이 공유한다 — 팀마다 다른 "성격"을 갖는 게
아니라, 보는 직원/티켓의 범위만 분리된다. 처음 실행하면 기존 직원/티켓을 자동으로 담을 **"기본
팀"**이 하나 만들어져 있다.

### 팀장

- **누가**: Claude Code (Claude Max 구독), `agents/manager.md` 파일 하나로 고정. 프롬프트는
  하나뿐이지만, 팀마다 독립된 인스턴스로(별도 세션·별도 직원 범위) 여러 개 동시에 굴릴 수 있다.
- **무엇을 하나**: 사용자 요청을 작업 단위로 쪼개고, 어떤 직원에게 맡길지 정하고, 끝난 작업의 상태를
  확인한다. **팀장은 직접 코드를 만지지 않는다** — 오직 분해·위임·확인만 한다.
- **어떻게 지시하나**: `list_projects`, `list_employees`, `create_ticket`, `get_ticket`, `list_tickets`,
  `ask_user` 6개의 MCP 툴로 직원에게 일을 맡기고 진행 상황을 확인한다.

### 직원 — 웹에서 추가/삭제, 이름으로 여러 명

직원은 **이름으로 구분**된다 (예: `백엔드-홍길동`, `백엔드-김철수` — 같은 성격의 직원을 여러 명 둘 수
있다). 우측 상단 **"직원 관리"** 버튼에서 추가/삭제하며, 각 직원마다 다음을 정한다:

- **이름**: 티켓의 담당자(`role`) 값으로 그대로 쓰인다.
- **AI 모델**: Claude Code / Gemini CLI / Codex CLI 중 하나.
- **담당 업무**: 자유 텍스트 설명 (예: "puppynote-server 백엔드 담당"). 팀장은 `list_employees`로
  이 설명을 보고 어떤 직원에게 위임할지 정한다 — 고정된 역할 목록이 아니라서, 담당 업무 설명이 곧
  그 직원의 정의다.
- 직원은 **특정 언어/프레임워크에 고정되지 않는다.** 작업 전에 대상 프로젝트의 실제 빌드 파일과
  기존 코드를 보고 스택을 파악하며, 그 프로젝트의 `CLAUDE.md`/`.claude/skills/`에 규칙이 있으면
  최우선으로 따르도록 프롬프트에 명시돼 있다 (`runner/src/employees/prompt.ts`).

새 직원을 추가하는 즉시(러너 재시작 없이) 다음 티켓부터 반영된다 — 직원 명단은 파일이 아니라 DB에서
매번 새로 읽는다.

#### AI 모델(CLI) 설치 확인

직원 추가 화면에서 각 모델 옆에 **설치됨 / 설치 안 됨**이 표시된다 (러너가 실행 중인 맥/PC에서
`claude`/`gemini`/`codex` 바이너리가 PATH에 있는지 확인). **로그인(OAuth) 여부까지는 자동으로 확인하거나
대신 진행해줄 수 없다** — 브라우저에서 CLI의 로그인 창을 대신 눌러줄 방법이 없기 때문에, 설치 안내만
보여주고 실제 로그인은 터미널에서 직접 해야 한다:

```bash
npm install -g @anthropic-ai/claude-code && claude   # 최초 실행 시 로그인 유도
npm install -g @google/gemini-cli && gemini
npm install -g @openai/codex && codex login
```

로그인이 잘못됐거나 그 CLI의 요금제가 안 맞으면(아래 참고) 실제로 티켓을 실행할 때 실패 로그로
보인다 — 설치 확인은 "켜져 있나"만 보고, 실제 동작 여부는 한 번 시켜봐야 확실하다.

**알려진 이슈**: 이 프로젝트를 만들면서 실제로 겪은 것들.
- Gemini CLI 무료 티어(`oauth-personal`, "Gemini Code Assist for individuals")가 서비스 종료되어
  최신 버전(0.53.0)에서도 `IneligibleTierError`가 난다 (Antigravity로 이전 요구). 유료 API 키 등
  다른 인증 방법이 필요할 수 있다.
- Codex CLI의 헤드리스 실행(`codex exec`)은 보통 OpenAI API 키 인증을 기대한다 — ChatGPT
  Plus/Pro의 대화형 로그인만으로 충분한지는 직접 확인이 필요하다.
- Gemini CLI의 워크스페이스(프로젝트) 레벨 권한 정책은 현재 비활성 상태라, `git push`/`rm` 같은
  위험 명령을 Claude만큼 확실하게 차단하지 못한다 (사용자 레벨 정책으로 best-effort 차단만 함).

### 협업 방식 — 티켓 + 동료 간 직접 소통

팀장과 직원은 **티켓**이라는 작업 단위로 소통한다 (사람 회사의 지라 티켓과 비슷하다고 생각하면 된다).

```
사용자 → 팀장 : "puppynote-server에 헬스체크 추가해줘"
팀장   → 백엔드 직원 : 티켓 발행 (담당자/프로젝트/제목/구체적 작업지시)
```

티켓은 다음 상태를 오간다:

```
queued(대기) → assigned(배정) → running(작업중) ─┬→ review(검수) → done(완료)
                                                 ├→ blocked(막힘)   → 팀장이 다른 직원에게 새 티켓 발행
                                                 ├→ needs_approval  → 위험한 명령이라 사용자 승인 대기
                                                 └→ failed(실패)
```

- **`blocked`가 핵심이다.** 직원이 작업 중 자기 담당 밖의 일이 필요하면(예: 프론트 작업 중 없는 백엔드
  API를 발견) `report_blocked` 툴로 팀장에게 보고한다. 티켓은 즉시 `blocked`가 되고, 팀장이 자동으로
  깨어나 상황을 파악한 뒤 다른 직원에게 `parentTicketId`를 걸어 새 티켓을 발행한다. 그 새 티켓이
  사람 승인을 거쳐 **실제로 메인 브랜치에 머지되면**(아래 참고), 원래 막혀있던 티켓이 자동으로
  재개되어 다시 시도한다.
- **사소한 건 직원끼리 팀장 없이 직접 묻는다.** `ask_peer` 툴로 동료 직원에게 비동기로 질문을 남길 수
  있다 (예: "응답 필드명이 isFavorited인가요?"). 물어본 쪽은 답을 기다리지 않고 하던 작업을 계속하고,
  받는 쪽은 자기 다음 티켓을 받을 때 미답변 질문을 보고 `answer_peer_message`로 답한다.
- 직원은 실제 프로젝트 폴더를 직접 건드리지 않고 **git worktree**라는 격리된 작업 공간에서만 일한다.
  `review` 티켓을 사람이 웹 UI에서 **승인**하면, 러너가 그 워크트리 브랜치를 실제로 프로젝트의 메인
  브랜치에 `git merge`하고 워크트리/브랜치를 정리한다 — 승인은 상태만 바꾸는 게 아니라 실제 머지를
  일으킨다.
- `git push`처럼 위험한 명령은 직원의 `requireApproval` 목록에 있으면 실행 전 차단된다
  (Claude는 `--disallowedTools`로 확실히, Gemini/Codex는 정책 엔진 한계로 best-effort).

### 프로젝트 — 폴더도 고정이 아니다

`WORKSPACE_ROOT`(`.env`) 아래 있는 프로젝트는 매번 스캔해서 자동으로 잡힌다 (새 폴더를 만들면 바로
다음 요청부터 보인다). **`WORKSPACE_ROOT` 밖의 임의 절대경로도** 사용자가 팀장에게 경로를 알려주면
그대로 작업 대상으로 쓸 수 있다 — `project` 값에 절대경로를 넣으면 러너가 그 경로를 그대로 쓴다.

## 지금까지 실제로 만들어진 것

- **0~4단계 (완료, MVP)**: 서버·DB·조직도 UI 골격, 티켓 상태머신 + 러너, 팀장의 MCP 툴 연결, 실제
  Claude 직원의 git worktree 작업, React Flow 조직도 UI. 전부 실제 시나리오로 검증했다 (자세한 내용은
  git 로그와 각 단계 커밋 메시지 참고).
- **6단계 (완료)**: `report_blocked` → 팀장 자동 호출 → `parentTicketId` 티켓 → 승인 시 실제 머지 →
  원래 티켓 자동 재개. **실전 시나리오로 검증** — puppynote-front-app에 "즐겨찾기 화면" 작업을 시켰더니
  필요한 API가 없어 blocked → 팀장이 puppynote-server에 백엔드 티켓 발행 → 실제 즐겨찾기 API 구현 +
  테스트 통과 → 승인 후 메인에 머지 → 프론트 티켓이 자동 재개되어 그 API로 화면을 완성했다.
- **7단계 (완료, 원래 계획 밖 확장)**: 직원을 이름 기반 DB 모델로 전환해 웹에서 자유롭게 추가/삭제,
  AI 모델(Claude/Gemini/Codex) 선택, 담당 업무 자유 기술이 가능해졌다. 직원 간 비동기 질문-답변
  (`ask_peer`), 임의 절대경로 프로젝트 지원, CLI 설치 여부 확인 UI, 크로스플랫폼(Windows) 경로 처리,
  git clone 직후 바로 실행되는 설정 스크립트를 추가했다.
- **5단계 (스킵)**: 외부 접속(Cloudflare Tunnel, 로그인)은 로컬 전용 사용으로 결정해 스킵했다.

### 검증 중 발견해 고친 주요 버그들

- **`job_meta` 이벤트 처리 버그**: 러너 이벤트 객체를 그대로 구조 분해하면서 `type` 필드가 Prisma
  `update()`에 섞여 들어가 조용히 실패 (`worktreePath`/`sessionId` 미저장). 필드를 명시적으로 뽑아 고쳤다.
- **티켓 상태 전이 경쟁 조건**: 러너 재연결 시 `recoverAndAssign`과 직원의 상태 보고가 동시에 같은
  티켓을 건드려 전이가 씹힘. 티켓 단위 락(`withTicketLock`) + 멱등 배정 함수(`ensureAssigned`)로 해결.
- **React Flow `fitView`는 최초 마운트 때만 적용됨**: 비동기로 나중에 로드되는 직원 노드가 화면 밖으로
  잘림. 노드 개수가 바뀔 때마다 `useReactFlow().fitView()`를 다시 부르도록 수정.
- **REST 승인/거부가 UI에 반영 안 됨**: 티켓 변경 브로드캐스트가 러너 이벤트 경로에만 있었음. 내부
  이벤트(`ticketEvents`) 리스너 한 곳에서 항상 UI로 브로드캐스트하도록 정리.
- **zustand 선택자가 안정적인 함수 참조라 리렌더링 안 됨**: `statusForRole`/`ticketsForRole` 같은
  헬퍼 함수를 구독하면 실제 데이터가 바뀌어도 리렌더링이 안 됐다. 데이터 객체 자체를 구독하도록 수정.
- **승인해도 실제로 머지가 안 됨**: `review → done` 승인이 상태만 바꾸고 워크트리 브랜치를 메인에
  머지하지 않아서, 완료된 작업이 다른 티켓에서 보이지 않았다. 러너가 실제 `git merge`를 수행하고
  워크트리를 정리하도록 추가.
- **재개된 티켓이 워크트리 충돌로 영구 정지**: blocked였다가 재개된 티켓이 같은 id로 다시 워크트리를
  만들려다 "브랜치 이미 존재" 에러로 실패, 아무도 상태를 안 바꿔서 `running`에 영원히 멈춤. 기존
  워크트리를 재사용하도록 수정하고, 드라이버가 예외로 죽으면 `failed`로 보고하도록 안전망 추가.

### 알려진 이슈 — macOS 폴더 권한 (Full Disk Access, 해결됨)

`list_projects`가 `WORKSPACE_ROOT`를 스캔하거나 `claude` CLI 자체를 실행하려고 하면 macOS의 TCC
(개인정보 보호) 정책 때문에 `EPERM`으로 막힌다. `~/Desktop`, `~/Documents`, `~/Downloads`는 macOS가
특별히 보호하는 폴더라 그 안의 내용을 읽으려는 프로세스는 권한을 받아야 한다.

**`System Settings → Privacy & Security → Full Disk Access`에서 러너를 실행할 터미널 앱에 권한을
켜주면 해결된다.** 러너를 상시 구동시키기 전에 반드시 해줘야 한다.

## 로컬 실행 (자세히)

`pnpm start`가 아래 단계를 자동으로 순서대로 실행해준다 (`scripts/start.mjs`). 디버깅 등으로 한 단계씩
직접 실행하고 싶을 때 참고:

```bash
node scripts/setup.mjs   # 최초 1회 - WORKSPACE_ROOT를 물어보고 .env 생성
docker compose -f infra/docker-compose.yml up -d --build
curl localhost:8080/health

# 최초 1회: DB 테이블 생성 (postgres 컨테이너가 뜬 뒤에)
DATABASE_URL="postgresql://aicrew:aicrew@localhost:5432/aicrew" \
  pnpm --filter @ai-crew/server exec prisma db push

# 러너(호스트 프로세스)는 팀장/직원 MCP 서버를 apps/server/dist/mcp/*.js로 직접 스폰한다 -
# 이건 도커 이미지 안의 dist가 아니라 호스트 파일시스템의 dist라서, 위 docker build와 별개로
# 호스트에서도 한 번 빌드해둬야 한다. 빠뜨리면 팀장이 list_projects/create_ticket 같은 MCP
# 툴을 하나도 못 쓰는 채로 조용히 동작한다 (겉보기엔 정상 종료라 원인 파악이 아주 어렵다).
pnpm --filter @ai-crew/shared build
pnpm --filter @ai-crew/server build

# 러너는 호스트에서 직접 실행 (컨테이너 아님 - JDK/Gradle/git worktree/CLI를 그대로 써야 하므로)
# 포그라운드로 로그를 보면서 띄우고 싶으면 pnpm start 대신 이렇게:
pnpm --filter @ai-crew/runner dev
```

내릴 때도 손으로 하려면 러너 프로세스를 직접 찾아 종료(`Ctrl+C` 또는 `kill`)한 뒤
`docker compose -f infra/docker-compose.yml down`을 실행하면 된다 (`pnpm stop`이 이 두 가지를
자동으로 해준다).

팀장을 CLI로 직접 불러서 테스트 (별도 터미널에서, `apps/server` 빌드가 먼저 되어 있어야
`mcp/server.js`가 존재함):

```bash
pnpm --filter @ai-crew/server build
pnpm --filter @ai-crew/runner manager "puppynote-server에 헬스체크 엔드포인트 추가해줘"
```

세션 id는 `~/.ai-crew/manager-session.json`에 저장되고, 다음 호출부터는 자동으로 `--resume`으로
이어진다 (대화가 끊기지 않음). 새로 시작하고 싶으면 그 파일을 지우면 된다.

`claude` CLI 없이 팀장용 MCP 툴만 따로 확인하고 싶으면:

```bash
pnpm --filter @ai-crew/server mcp:test
```

직원을 만들고 티켓을 던져서 파이프라인이 도는지 확인:

```bash
curl -X POST localhost:8080/api/employees -H "Content-Type: application/json" -d \
  '{"name":"백엔드-테스트","driver":"claude","taskDescription":"puppynote-server 백엔드 담당"}'
curl -X POST localhost:8080/api/tickets -H "Content-Type: application/json" \
  -d '{"role":"백엔드-테스트","project":"puppynote-server","title":"test","spec":"just testing"}'
curl localhost:8080/api/tickets
```

조직도 UI는 `docker compose up`으로 뜬 뒤 브라우저에서 `http://localhost` (Caddy 경유)로 접속하면
된다. 개발 중에는 `pnpm dev:web`으로 Vite dev 서버(`http://localhost:5173`)를 띄우면 `/api`, `/ws`가
`localhost:8080`으로 자동 프록시된다 (`apps/web/vite.config.ts`).

## 개발

```bash
pnpm install
pnpm dev:server   # apps/server
pnpm dev:web      # apps/web
pnpm dev:runner   # runner (호스트에서 직접 실행, 컨테이너 아님)
```
