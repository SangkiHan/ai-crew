import { useState } from "react";
import { DRIVER_MODEL_OPTIONS, type Driver } from "@ai-crew/shared";
import { useStore } from "./store.js";
import { DRIVER_OPTIONS } from "./EmployeeManager.js";
import { updateTeamDbConfig, updateTeamManagerConfig, updateTeamProjects, type TeamDbConfig } from "./lib/api.js";

// claude만 대화 이어가기(--resume)를 지원한다 - 다른 CLI로 바꾸면 팀장이 직전 대화를 기억하지
// 못한 채 매번 새 세션으로 시작한다(runner/src/manager/drivers.ts에 문서화된 한계). 드라이버
// 버튼 옆에 이 사실을 알려줘야 사용자가 "왜 갑자기 맥락을 까먹지" 하고 당황하지 않는다.
const DRIVER_RESUME_WARNING: Partial<Record<Driver, string>> = {
  antigravity: "Antigravity CLI는 대화 이어가기를 지원하지 않습니다 - 팀장이 매번 새 세션으로 시작해 직전 대화를 기억하지 못합니다.",
  codex: "Codex CLI는 대화 이어가기를 지원하지 않습니다 - 팀장이 매번 새 세션으로 시작해 직전 대화를 기억하지 못합니다.",
};

// 팀이 담당하는 프로젝트 이름/절대경로 목록과 팀장 모델을 관리한다. 프로젝트 목록은 팀장 호출 시
// 시스템 프롬프트에 그대로 포함되어, list_projects MCP 툴 연결 여부와 무관하게 팀장이 자기 담당
// 프로젝트를 확실히 알 수 있게 한다 (선택 사항 - 비워두면 기존처럼 list_projects로 스캔).
export function TeamProjectsManager({ teamId, onClose }: { teamId: string; onClose: () => void }) {
  const teams = useStore((s) => s.teams);
  const setTeams = useStore((s) => s.setTeams);
  const team = teams.find((t) => t.id === teamId);
  // team.managerDriver 타입은 mock을 포함한 Driver라 DRIVER_MODEL_OPTIONS(mock 제외) 인덱싱에
  // 그대로 못 쓴다 - 팀장은 서버가 애초에 mock을 거부하므로(routes/teams.ts) 실질적으로 항상
  // claude/antigravity/codex 중 하나다.
  const managerDriver = (team?.managerDriver ?? "claude") as Exclude<Driver, "mock">;

  const [newProject, setNewProject] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelSubmitting, setModelSubmitting] = useState(false);
  const [dbConfig, setDbConfig] = useState({
    devDbUrl: team?.devDbUrl ?? "",
    devDbUser: team?.devDbUser ?? "",
    devDbPassword: team?.devDbPassword ?? "",
    prodDbUrl: team?.prodDbUrl ?? "",
    prodDbUser: team?.prodDbUser ?? "",
    prodDbPassword: team?.prodDbPassword ?? "",
  });
  const [dbConfigSubmitting, setDbConfigSubmitting] = useState(false);

  async function save(nextProjects: string[]) {
    setSubmitting(true);
    setError(null);
    try {
      const updated = await updateTeamProjects(teamId, nextProjects);
      setTeams(teams.map((t) => (t.id === teamId ? updated : t)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  // model=null이면 agents/manager.md 프론트매터의 기본 모델을 그대로 쓴다("기본값" 선택지).
  // driver를 생략하면 지금 팀의 드라이버를 유지 - 모델만 바꿀 때 쓴다.
  async function saveManagerConfig(driver: Driver | undefined, model: string | null) {
    setModelSubmitting(true);
    setError(null);
    try {
      const updated = await updateTeamManagerConfig(teamId, driver, model);
      setTeams(teams.map((t) => (t.id === teamId ? updated : t)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setModelSubmitting(false);
    }
  }

  // 드라이버가 바뀌면 이전 드라이버 기준으로 고른 모델 값이 새 드라이버에 안 맞을 수 있어
  // model을 항상 기본값(null)으로 함께 리셋한다.
  function handleDriverChange(driver: Driver) {
    saveManagerConfig(driver, null);
  }

  async function handleAdd() {
    const value = newProject.trim();
    if (!value || !team) return;
    if (team.projects.includes(value)) {
      setNewProject("");
      return;
    }
    await save([...team.projects, value]);
    setNewProject("");
  }

  async function handleRemove(project: string) {
    if (!team) return;
    await save(team.projects.filter((p) => p !== project));
  }

  async function handleSaveDbConfig() {
    setDbConfigSubmitting(true);
    setError(null);
    try {
      const config: TeamDbConfig = {
        devDbUrl: dbConfig.devDbUrl.trim() || null,
        devDbUser: dbConfig.devDbUser.trim() || null,
        devDbPassword: dbConfig.devDbPassword || null,
        prodDbUrl: dbConfig.prodDbUrl.trim() || null,
        prodDbUser: dbConfig.prodDbUser.trim() || null,
        prodDbPassword: dbConfig.prodDbPassword || null,
      };
      const updated = await updateTeamDbConfig(teamId, config);
      setTeams(teams.map((t) => (t.id === teamId ? updated : t)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDbConfigSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-100">팀 설정 ({team?.name})</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <h3 className="mb-2 text-sm font-semibold text-slate-200">팀장 AI</h3>
          <p className="mb-3 text-xs text-slate-500">
            이 팀 팀장을 실행할 CLI입니다. 직원처럼 팀마다 다르게 고를 수 있습니다 - 어떤 CLI가
            설치돼 있는지는 "직원 관리"의 설치 상태에서 확인하세요.
          </p>
          <div className="mb-2 flex flex-wrap gap-2">
            {DRIVER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handleDriverChange(opt.value as Driver)}
                disabled={modelSubmitting}
                className={[
                  "rounded-md border px-3 py-1.5 text-xs disabled:opacity-50",
                  managerDriver === opt.value
                    ? "border-sky-500 bg-sky-500/10 text-sky-300"
                    : "border-slate-700 text-slate-300 hover:bg-slate-800",
                ].join(" ")}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {DRIVER_RESUME_WARNING[managerDriver] && (
            <p className="mb-3 text-xs text-amber-400">⚠️ {DRIVER_RESUME_WARNING[managerDriver]}</p>
          )}

          <h3 className="mb-2 mt-4 text-sm font-semibold text-slate-200">팀장 모델</h3>
          <p className="mb-3 text-xs text-slate-500">
            "기본값"은 agents/manager.md에 정의된 기본 모델을 그대로 씁니다.
          </p>
          <div className="mb-6 flex flex-wrap gap-2">
            <button
              onClick={() => saveManagerConfig(undefined, null)}
              disabled={modelSubmitting}
              className={[
                "rounded-md border px-3 py-1.5 text-xs disabled:opacity-50",
                !team?.managerModel
                  ? "border-sky-500 bg-sky-500/10 text-sky-300"
                  : "border-slate-700 text-slate-300 hover:bg-slate-800",
              ].join(" ")}
            >
              기본값
            </button>
            {DRIVER_MODEL_OPTIONS[managerDriver].map((opt) => (
              <button
                key={opt.value}
                onClick={() => saveManagerConfig(undefined, opt.value)}
                disabled={modelSubmitting}
                className={[
                  "rounded-md border px-3 py-1.5 text-xs disabled:opacity-50",
                  team?.managerModel === opt.value
                    ? "border-sky-500 bg-sky-500/10 text-sky-300"
                    : "border-slate-700 text-slate-300 hover:bg-slate-800",
                ].join(" ")}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <h3 className="mb-2 text-sm font-semibold text-slate-200">담당 프로젝트</h3>
          <p className="mb-4 text-xs text-slate-500">
            이 팀이 담당하는 프로젝트의 <strong className="text-slate-400">절대경로</strong>를
            등록하세요 (WORKSPACE_ROOT 밖의 다른 위치도 그대로 가능합니다 - 프로젝트가 실제로 있는
            폴더 경로를 그대로 넣으면 됩니다). 등록된 목록은 팀장이 호출될 때마다 시스템 프롬프트에
            그대로 포함되어 우선 참고됩니다. 비워두면 팀장은 지금처럼 WORKSPACE_ROOT를
            list_projects로 스캔해서 찾습니다.
          </p>

          <div className="mb-4 flex flex-col gap-1.5">
            {!team || team.projects.length === 0 ? (
              <p className="text-sm text-slate-500">아직 등록된 프로젝트가 없습니다.</p>
            ) : (
              team.projects.map((p) => (
                <div
                  key={p}
                  className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2"
                >
                  <span className="truncate text-sm text-slate-200">{p}</span>
                  <button
                    onClick={() => handleRemove(p)}
                    disabled={submitting}
                    className="ml-2 shrink-0 rounded-md bg-rose-600/80 px-2 py-1 text-xs text-white hover:bg-rose-600 disabled:opacity-50"
                  >
                    삭제
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="flex gap-2">
            <input
              value={newProject}
              onChange={(e) => setNewProject(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
              }}
              placeholder="예: C:\Users\tkdrl\Desktop\Project\cleaning (다른 드라이브/위치도 가능)"
              className="flex-1 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
            />
            <button
              onClick={handleAdd}
              disabled={submitting || !newProject.trim()}
              className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              추가
            </button>
          </div>
          <h3 className="mb-2 mt-6 text-sm font-semibold text-slate-200">DB 조회 연결</h3>
          <p className="mb-3 text-xs text-slate-500">
            DB 조회 기능(상단 "DB 조회" 버튼)과 팀장/직원의 query_db 툴이 사용할 연결 정보입니다.
            URL에는 자격증명 없이
            <code className="mx-1 rounded bg-slate-800 px-1 py-0.5 text-[11px]">postgresql://host:5432/db</code>
            또는
            <code className="mx-1 rounded bg-slate-800 px-1 py-0.5 text-[11px]">mysql://host:3306/db</code>
            형식으로 입력하고, 아이디/비밀번호는 따로 입력하세요. application.yml의
            spring.datasource.url을 그대로 붙여넣어도 됩니다 (
            <code className="mx-1 rounded bg-slate-800 px-1 py-0.5 text-[11px]">jdbc:</code>
            접두사와 뒤에 붙는 쿼리 파라미터를 그대로 인식합니다). SELECT 조회만 가능합니다 - 그 외
            구문은 서버가 거부합니다.
          </p>
          <div className="mb-4 flex flex-col gap-4">
            <DbConnectionFields
              label="개발 DB"
              urlPlaceholder="postgresql://host:5432/db"
              url={dbConfig.devDbUrl}
              user={dbConfig.devDbUser}
              password={dbConfig.devDbPassword}
              onChange={(field, value) => setDbConfig((c) => ({ ...c, [`dev${field}`]: value }))}
            />
            <DbConnectionFields
              label="운영 DB"
              urlPlaceholder="mysql://host:3306/db"
              url={dbConfig.prodDbUrl}
              user={dbConfig.prodDbUser}
              password={dbConfig.prodDbPassword}
              onChange={(field, value) => setDbConfig((c) => ({ ...c, [`prod${field}`]: value }))}
            />
          </div>
          <button
            onClick={handleSaveDbConfig}
            disabled={dbConfigSubmitting}
            className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            DB 연결 저장
          </button>

          {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
        </div>
      </div>
    </div>
  );
}

// dev/운영 DB 각각 URL(자격증명 없이)/아이디/비밀번호 3칸을 같은 모양으로 보여준다.
function DbConnectionFields({
  label,
  urlPlaceholder,
  url,
  user,
  password,
  onChange,
}: {
  label: string;
  urlPlaceholder: string;
  url: string;
  user: string;
  password: string;
  onChange: (field: "DbUrl" | "DbUser" | "DbPassword", value: string) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-slate-300">{label}</p>
      <div className="flex flex-col gap-1.5">
        <input
          value={url}
          onChange={(e) => onChange("DbUrl", e.target.value)}
          placeholder={urlPlaceholder}
          className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
        />
        <div className="flex gap-1.5">
          <input
            value={user}
            onChange={(e) => onChange("DbUser", e.target.value)}
            placeholder="아이디"
            className="w-1/2 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
          />
          <input
            value={password}
            onChange={(e) => onChange("DbPassword", e.target.value)}
            type="password"
            placeholder="비밀번호"
            className="w-1/2 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
          />
        </div>
      </div>
    </div>
  );
}
