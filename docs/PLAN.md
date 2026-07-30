# AI 직원 팀 (ai-crew) 구축 계획 — 맥 환경 검증판

## Context

다른 컴퓨터에서 초안을 작성한 계획서를 실제 작업 대상 맥에서 검증했다. 전체 아키텍처(팀장=Claude Code, 직원=Gemini/Codex CLI, 티켓 상태머신, 하이브리드 Docker+호스트 러너)는 그대로 유효하지만, **환경을 직접 점검한 결과 몇 가지 핵심 전제가 실제와 달라 경로·범위를 이 문서에서 교정한다.** 이 문서가 앞으로의 기준 계획서다.

---

## 0. 환경 점검 결과 (원안과 실제의 차이)

| 항목 | 원안 가정 | 실제 확인 결과 | 조치 |
|---|---|---|---|
| 맥 작업 대상 루트 | `~/PProject` | **`~/Desktop/Project`** (이 세션이 열려있는 바로 그 폴더) | `WORKSPACE_ROOT=~/Desktop/Project` 로 확정. 폴더 이동/생성 불필요 |
| 대상 프로젝트 개수 | 13개 고정 | 현재 **7개**만 존재 (아래 표) | 개수를 하드코딩하지 않고 **디렉터리 스캔 방식**으로 설계 (사용자 확인: 필요하면 새 프로젝트를 이 폴더 안에 직접 생성할 수도 있음) |
| git 저장소 여부 | 5개는 git 아님 (Windows 기준) | **7개 전부 git 저장소** | "격리 없음 경고 배지" 로직은 유지하되(향후 non-git 프로젝트 생성 대비), 지금 당장 처리할 대상은 없음 |
| ai-crew 레포 위치 | `~/dev/ai-crew` | 사용자 지정: **`~/ai-crew`** | 원격 저장소 `https://github.com/SangkiHan/ai-crew.git` 에 연결 (아래 참고) |
| Claude Code CLI | 설치 가정 | ✅ 설치됨 (`2.1.220`, nvm node v24.14.0 경로) | 그대로 사용 |
| Gemini CLI | 설치 가정 | ✅ 설치됨 (`0.42.0`) | 그대로 사용 |
| Codex CLI | 설치 가정 | ❌ 미설치 | 6단계(직원 증원) 착수 전 설치 + ChatGPT 계정 로그인 필요 |
| Docker | Docker Desktop 또는 OrbStack | ✅ Docker Desktop `29.5.2` 실행 중, OrbStack은 없음 | Docker Desktop 기준으로 진행 |
| Node / JDK | 필요 | ✅ Node v24.14.0(nvm), ✅ OpenJDK 17.0.18 | 그대로 사용 |
| Go | golang 프로젝트용으로 가정 | ❌ 미설치. **현재 7개 프로젝트 중 Go 프로젝트 없음** | 지금 단계에서 불필요. 나중에 Go 프로젝트가 추가되면 그때 설치 |
| pnpm | 모노레포 도구로 필요 | ❌ 미설치 | 0단계(스캐폴딩) 전에 설치 필요 |
| gh CLI | 레포 생성에 필요 | ❌ 미설치 | `ai-crew` 레포 생성 전에 설치 (또는 GitHub 웹에서 수동 생성) |
| cloudflared | 5단계 외부 노출용 | ❌ 미설치 | 5단계(외부 노출) 착수 전에 설치 |
| 원본 계획 파일 (`~/.claude/plans/fluttering-chasing-journal.md`) | 이 맥에 존재 가정 | 존재하지 않음 (빈 디렉터리) | 이 문서(`ai-deep-allen.md`)가 유일한 기준 계획서 |

### 실제 존재하는 7개 프로젝트와 스택

`~/Desktop/Project/` 하위, 모두 git 저장소:

| 프로젝트 | 스택 | 역할 매핑 |
|---|---|---|
| `puppynote-server` | Spring Boot / Gradle | 백엔드 직원 |
| `quitmate-admin-server` | Spring Boot / Gradle | 백엔드 직원 |
| `addiction` | Spring Boot / Gradle (이름과 달리 백엔드) | 백엔드 직원 |
| `puppynote-front-app` | Expo / React Native 19 | 프론트 직원 |
| `addiction-front-app` | Expo / React Native 19 | 프론트 직원 |
| `addiction-front-native` | React Native 19 (front-app과 중복 성격으로 보임, 용도 확인 필요) | 프론트 직원 |
| `quitmate-admin-front` | React 19 웹 | 프론트 직원 |

→ 현재 스택은 **Spring Boot(Gradle) 백엔드 3개 + React/React Native 프론트 4개**로만 구성되어 있어, MVP 단계에서 Go 툴체인이나 `puppymap`/`gateway` 계열 규칙은 필요 없다. 원안의 "직원 정의 파일 예시"에 등장하는 프로젝트명(`puppynote-server-golang`, `gateway` 등)은 이 맥에는 없는 대상이므로 실제 존재하는 이름으로 교체한다.

`list_projects()` MCP 툴은 **정적 목록이 아니라 `WORKSPACE_ROOT`를 스캔**해 현재 폴더 구성을 그대로 반환하도록 구현한다 (사용자가 폴더를 직접 추가/생성할 수 있으므로). git 여부·package.json/build.gradle 존재 여부로 스택을 간이 추정해 함께 반환하면 팀장이 위임 판단에 활용할 수 있다.

---

## 1. 왜 레포 1개인가 (원안 유지)

| | 내용 |
|---|---|
| **새로 만들 레포** | `ai-crew` **1개**, 위치 `~/ai-crew` |
| **기존 프로젝트들** | `~/Desktop/Project/*` — 건드리지 않음. ai-crew가 *작업 대상*으로만 마운트/참조 |

서버·UI·러너가 티켓/이벤트 타입을 공유하고, `docker compose up` 한 번으로 전체가 떠야 하며, 혼자 개발하므로 레포를 쪼갤 이유가 없다.

---

## 2. 아키텍처 (원안 유지, 검증 완료)

```
        인터넷 ──► Cloudflare Tunnel ──┐
                                       ▼
┌─────────── Docker (맥) ────────────────────────┐
│  caddy      : TLS + 로그인 게이트               │
│  web        : React + React Flow 조직도 (nginx) │
│  server     : Fastify + WS + 티켓 상태머신      │
│  postgres   : 티켓 / 로그 / 세션                │
└───────────────────┬─────────────────────────────┘
                    │ WebSocket (localhost 전용, 외부 비노출)
┌───────────────────▼──── 맥 호스트 ──────────────┐
│  runner (launchd 상시)                          │
│    ├─ 팀장  : claude -p --output-format stream-json --resume
│    ├─ 백엔드: claude -p  (별도 세션)             │
│    ├─ 프론트: gemini     (2단계)                 │
│    └─ 서류  : codex      (2단계)                 │
│  작업 공간: ~/Desktop/Project/*  + git worktree 격리 │
│  툴체인   : JDK 17, Node(nvm), Docker CLI       │
└─────────────────────────────────────────────────┘
```

이 구조의 이점: 러너는 호스트 툴체인(JDK/Node)과 기존 프로젝트의 `gradlew`/`npm`을 그대로 쓸 수 있어 Docker-out-of-Docker 경로 꼬임 문제를 원천 회피한다.

### 팀장을 프레임워크 없이 구현하는 이유 (원안 유지)

LangGraph / CrewAI 같은 오케스트레이션 프레임워크를 쓰지 않는다. 팀장이 Claude Code이므로 작업 분해·툴 호출·서브에이전트 루프가 이미 내장되어 있다. 필요한 것은 "직원에게 일을 시키는 툴" 하나뿐이고, MCP 서버로 붙인다.

팀장은 상시 세션이 아니라 job으로 실행한다. 사용자 메시지가 오거나 직원이 결과를 보고했을 때만 `--resume <session_id>`로 깨워 대화를 이어간다.

### 팀장에게 물릴 MCP 툴 (`apps/server/src/mcp/`)

| 툴 | 역할 |
|---|---|
| `list_projects()` | `WORKSPACE_ROOT` 스캔 결과 — 실제 존재하는 프로젝트와 추정 스택 목록 (정적 목록 아님) |
| `create_ticket(role, project, title, spec)` | 직원에게 위임. 즉시 반환(비동기) |
| `get_ticket(id)` | 진행 상황·결과 조회 |
| `list_tickets(status?)` | 현재 보드 상태 |
| `ask_user(question)` | 판단이 필요할 때 UI로 질문 올리기 |

### 티켓 상태머신 (`packages/shared/src/ticket.ts`, 원안 유지)

```
queued → assigned → running ─┬─→ review → done
                             ├─→ blocked   (다른 직원 필요 → 팀장이 새 티켓 발행)
                             ├─→ needs_approval  (위험 명령 → UI에서 사용자 승인)
                             └─→ failed
```

`blocked`가 "프론트 작업 중 백엔드 수정 필요" 시나리오를 처리하는 경로. 직원은 팀장에게만 에스컬레이션한다.

---

## 3. 디렉터리 구조

```
~/ai-crew/                        (신규 레포, GitHub 생성 후 clone)
├── apps/
│   ├── server/                  # Fastify + WS + Prisma
│   │   └── src/
│   │       ├── routes/          # REST: 티켓, 프로젝트, 채팅
│   │       ├── ws/              # UI 스트림 + 러너 채널(분리)
│   │       ├── mcp/             # 팀장용 MCP 서버 (stdio)
│   │       ├── tickets/         # 상태머신, 배정 로직
│   │       └── auth/            # 단일 사용자 세션 로그인
│   └── web/                     # Vite + React + React Flow + Tailwind + zustand
│       └── src/
│           ├── OrgChart.tsx
│           ├── AgentNode.tsx
│           ├── DetailPanel.tsx
│           └── ChatBar.tsx
├── packages/shared/             # 티켓·이벤트·에이전트 타입
├── runner/                      # 호스트 데몬 (TypeScript, Node)
│   └── src/
│       ├── index.ts             # 서버 WS 연결, job pull
│       ├── drivers/             # claude.ts / gemini.ts / codex.ts
│       ├── worktree.ts          # git worktree 생성·정리
│       └── stream.ts            # stdout → 이벤트 파싱 → 서버 전송
├── agents/                      # 직원 정의 (마크다운 + 프론트매터)
│   ├── manager.md
│   ├── backend.md               # projects: [addiction, puppynote-server, quitmate-admin-server]
│   └── frontend.md              # projects: [addiction-front-app, addiction-front-native, puppynote-front-app, quitmate-admin-front]
├── infra/
│   ├── docker-compose.yml       # WORKSPACE_ROOT=~/Desktop/Project 를 러너에 주입
│   ├── Caddyfile
│   └── com.aicrew.runner.plist
└── docs/PLAN.md                 # 이 문서를 복사해 넣음
```

### 직원 정의 파일 예시 (`agents/backend.md`) — 실제 프로젝트명으로 교정

```markdown
---
id: backend
name: 백엔드 직원
driver: claude
model: sonnet
projects: [addiction, puppynote-server, quitmate-admin-server]
allowedTools: [Read, Edit, Write, Bash, Grep, Glob]
requireApproval: [git push, docker compose down, rm]
---
당신은 Spring Boot(Gradle) 백엔드 담당입니다. ...
```

**직원 추가 = 이 파일 하나 추가.** 코드 수정 불필요.

---

## 4. 사전 준비 (사용자 작업, 착수 전)

1. **툴체인 설치**
   - `pnpm` 설치 (`corepack enable` 또는 `npm i -g pnpm`) — 0단계 스캐폴딩에 필요
   - `codex` CLI 설치 + ChatGPT 계정 로그인 — 6단계(서류 직원) 전까지만 필요, 미리 해둬도 됨
   - `cloudflared` 설치 — 5단계(외부 노출) 전까지만 필요
2. **원격 저장소 연결**: `https://github.com/SangkiHan/ai-crew.git` 이 이미 지정된 원격 주소. `~/ai-crew`에 프로젝트를 생성하고(clone 또는 init 후 remote add) 이 원격에 연결한다. `gh` CLI 없이도 git만으로 가능하므로 별도 설치 불필요.
3. **`~/Desktop/Project` 재확인** — 새 프로젝트가 생기면 다음 명령으로 git 여부 재점검:
   ```bash
   for d in ~/Desktop/Project/*/; do [ -d "$d/.git" ] && echo "git  $(basename $d)" || echo "  -  $(basename $d)"; done
   ```

### 커밋/푸시 방침 (사용자 사전 승인)

`ai-crew` 레포 자체를 만들어가는 동안, **단계/기능 단위로 작업이 끝날 때마다 확인 없이 자동으로 commit + push** 한다 (사용자가 명시적으로 사전 승인). 예: 0단계 스캐폴딩 완료 → 커밋+푸시, 1단계 티켓 백본 완료 → 커밋+푸시, 이런 식으로 표 6의 각 단계가 완료 기준을 만족할 때마다 반복. 단, force-push나 히스토리 재작성은 이 승인 범위에 포함되지 않으며 별도 확인이 필요하다.

---

## 5. 보안 (원안 유지)

**권장: Cloudflare Tunnel**
- 공유기 포트를 열지 않음 (인바운드 0), 무료, HTTPS 자동
- Cloudflare Access로 구글 계정 로그인 게이트 추가 가능

**포트포워딩을 선택할 경우 타협 불가 항목**: Caddy HTTPS 강제, 로그인 필수(세션 쿠키+Argon2), 러너 WS 포트 절대 미포워딩, rate limit, 공유기 관리 페이지/SSH 동시 노출 금지

**공통 적용**: `requireApproval` 명령은 실행 전 UI 승인 요구 / 러너는 `~/Desktop/Project` 밖 경로 접근 차단 (경로 화이트리스트) / 모든 실행 명령 감사 로그

---

## 6. 단계별 구현

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| **0. 스캐폴딩** | pnpm 모노레포, shared 타입, docker-compose(server/web/postgres/caddy), Prisma 스키마, `WORKSPACE_ROOT=~/Desktop/Project` 주입 | `docker compose up` → `/health` 200 |
| **1. 티켓 백본** | 티켓 CRUD + 상태머신, 러너 WS 채널, **mock 드라이버** | mock 직원이 티켓을 `done`까지 진행, WS 방송 확인 |
| **2. 팀장 연결** | Claude Code headless 구동, MCP 5개 툴(스캔 기반 `list_projects`), 세션 `--resume` 유지 | "puppynote-server에 헬스체크 추가해줘" → 팀장이 티켓 생성 |
| **3. 백엔드 직원** | claude 드라이버, git worktree 격리, stdout 스트림 파싱, 대상: `addiction`/`puppynote-server`/`quitmate-admin-server` | 워크트리에 실제 커밋, 팀장 검수 후 `done` |
| **4. 조직도 UI** | React Flow 조직도, 노드 상태 색상, 실시간 로그, 채팅바, 승인 다이얼로그 | 브라우저 지시 → 노드 상태 변화 확인 |
| **5. 외부 노출** | 로그인, Cloudflare Tunnel, launchd 상시 구동 | 폰 LTE 접속·지시 성공 |
| **6. 직원 증원** | gemini(프론트 4개 프로젝트)/codex 드라이버, `agents/*.md` 추가 | 프론트 작업 중 `blocked` → 팀장이 백엔드 티켓 발행 → 재개 |

**MVP = 0~4단계.**

---

## 7. 검증 방법

**로컬 기동**
```bash
docker compose -f infra/docker-compose.yml up -d
curl localhost:8080/health
pnpm --filter runner dev
```

**1단계**: mock 드라이버로 티켓 3개 동시 투입 → 큐잉/병렬/상태전이 확인. 러너 강제종료 후 재시작 → `running` 티켓 복구 확인.

**3단계 (핵심)**: 실제 시나리오
> "puppynote-server에 `/actuator/health` 노출하고 테스트 추가해줘"

기대 동작: 팀장이 티켓 생성 → 백엔드 직원이 `~/Desktop/Project/puppynote-server`의 worktree에서 작업 → `./gradlew test` 통과 → 커밋 → 팀장 diff 검수 → `review` → 사용자 승인 → 머지. `git -C ~/Desktop/Project/puppynote-server log`로 확인.

**6단계 (에스컬레이션, 존재 이유)**: 프론트 직원(`puppynote-front-app` 등)에게 백엔드 API 없는 화면을 시켜서 `blocked` → 팀장이 `puppynote-server` 백엔드 티켓 발행 → 완료 후 프론트 자동 재개 확인.

**외부 검증**: 폰 Wi-Fi 끄고 LTE로 접속 → 로그인 → 지시 → 결과 확인.

---

## 8. 리스크 (원안 대비 갱신)

| 리스크 | 대응 |
|---|---|
| Claude Max 동시 세션 rate limit | 러너 동시 실행 수 2~3 제한, 초과분 큐 대기 |
| 직원이 잘못된 대규모 수정 | worktree 격리 + 사용자 승인 후에만 머지 |
| 장시간 작업 중 러너 크래시 | 티켓 `heartbeat` 기록, 타임아웃 시 `failed` 후 재시도 |
| **(갱신)** 현재 7개 프로젝트는 모두 git — 당장 리스크 아님 | 단, 새 프로젝트를 폴더에 직접 생성하는 경우 대비해 non-git 감지 로직은 구현해둔다 |
| **(갱신)** `addiction-front-app`과 `addiction-front-native`가 이름이 유사해 역할 중복으로 보임 | 착수 전 실제 용도 확인 필요 (하나가 레거시일 가능성) |
| Gemini/Codex CLI 출력 포맷 차이 | 드라이버별 파서 분리. shared 이벤트 타입으로 정규화 |
