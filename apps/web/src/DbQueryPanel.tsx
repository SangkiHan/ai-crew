import { useEffect, useState } from "react";
import type { DbEnv, DbQueryResult } from "@ai-crew/shared";
import { useStore } from "./store.js";
import { queryTeamDb } from "./lib/api.js";

// pg/mysql2가 JSON/JSONB 컬럼을 이미 파싱된 객체·배열로 돌려주는데, 그걸 그대로 String()하면
// "[object Object]"만 찍힌다 - 실제 값을 읽을 수 있게 JSON 문자열로 바꿔서 보여준다.
function formatCell(cell: unknown): string {
  if (cell === null) return "";
  if (typeof cell === "object") return JSON.stringify(cell);
  return String(cell);
}

interface CellPos {
  r: number;
  c: number;
}

const DEFAULT_LIMIT = 10;

// 사용자가 LIMIT을 직접 안 썼을 때만 호출된다 - 큰 테이블을 실수로 통째로 긁는 걸 막는 기본값.
// 세미콜론으로 끝나면 그 앞에 끼워 넣는다.
function withDefaultLimit(sqlRaw: string): string {
  const trimmed = sqlRaw.trimEnd();
  const withoutTrailingSemi = trimmed.endsWith(";") ? trimmed.slice(0, -1) : trimmed;
  return `${withoutTrailingSemi} LIMIT ${DEFAULT_LIMIT}`;
}

// 팀 설정에 등록된 dev/prod DB에 SELECT 쿼리를 실행해 결과를 표로 보여준다. 서버가 SELECT 외
// 구문을 거부하므로(apps/server/src/db-query/run.ts) 여기서는 별도 검증 없이 그대로 보낸다.
export function DbQueryPanel({ teamId, onClose }: { teamId: string; onClose: () => void }) {
  const team = useStore((s) => s.teams.find((t) => t.id === teamId));
  const availableEnvs: DbEnv[] = [
    ...(team?.devDbUrl ? (["dev"] as const) : []),
    ...(team?.prodDbUrl ? (["prod"] as const) : []),
  ];

  const [env, setEnv] = useState<DbEnv | null>(availableEnvs[0] ?? null);
  const [sql, setSql] = useState("SELECT * FROM ");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DbQueryResult | null>(null);
  const [autoLimited, setAutoLimited] = useState(false);

  // DBeaver처럼 클릭은 셀 하나를 선택하고, 드래그하면 사각형 범위로 넓어진다 - 클립보드 복사는
  // Ctrl+C를 눌러야 일어난다(클릭 즉시 복사하지 않음).
  const [selStart, setSelStart] = useState<CellPos | null>(null);
  const [selEnd, setSelEnd] = useState<CellPos | null>(null);
  const [dragging, setDragging] = useState(false);
  const [copiedFlash, setCopiedFlash] = useState(false);

  const selRange = selStart && selEnd
    ? {
        r0: Math.min(selStart.r, selEnd.r),
        r1: Math.max(selStart.r, selEnd.r),
        c0: Math.min(selStart.c, selEnd.c),
        c1: Math.max(selStart.c, selEnd.c),
      }
    : null;

  function isSelected(r: number, c: number): boolean {
    return !!selRange && r >= selRange.r0 && r <= selRange.r1 && c >= selRange.c0 && c <= selRange.c1;
  }

  function handleCellMouseDown(r: number, c: number, e: React.MouseEvent) {
    e.preventDefault(); // 네이티브 텍스트 드래그 선택 대신 셀 단위 선택을 쓴다
    setSelStart({ r, c });
    setSelEnd({ r, c });
    setDragging(true);
  }

  useEffect(() => {
    function onMouseUp() {
      setDragging(false);
    }
    window.addEventListener("mouseup", onMouseUp);
    return () => window.removeEventListener("mouseup", onMouseUp);
  }, []);

  // 입력창(SQL 텍스트영역 등)에 포커스가 있을 때는 그쪽의 기본 Ctrl+C를 그대로 두고, 표 선택이
  // 있을 때만 탭/줄바꿈으로 구분된 스프레드시트용 텍스트를 클립보드에 넣는다.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isCopy = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c";
      if (!isCopy || !result || !selRange) return;
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      e.preventDefault();
      const lines: string[] = [];
      for (let r = selRange.r0; r <= selRange.r1; r++) {
        const cells: string[] = [];
        for (let c = selRange.c0; c <= selRange.c1; c++) {
          cells.push(formatCell(result.rows[r][c]));
        }
        lines.push(cells.join("\t"));
      }
      navigator.clipboard.writeText(lines.join("\n")).then(() => {
        setCopiedFlash(true);
        setTimeout(() => setCopiedFlash(false), 1200);
      });
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [result, selRange]);

  async function handleRun() {
    if (!env || !sql.trim()) return;
    setRunning(true);
    setError(null);
    setResult(null);
    setSelStart(null);
    setSelEnd(null);
    const hasLimit = /\blimit\s+\d+/i.test(sql);
    const finalSql = hasLimit ? sql : withDefaultLimit(sql);
    setAutoLimited(!hasLimit);
    try {
      setResult(await queryTeamDb(teamId, env, finalSql));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-100">DB 조회 ({team?.name})</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {availableEnvs.length === 0 ? (
            <p className="text-sm text-slate-500">
              이 팀에 등록된 DB가 없습니다. "팀 설정"에서 개발/운영 DB 연결 문자열을 먼저 등록하세요.
            </p>
          ) : (
            <>
              <div className="mb-3 flex gap-2">
                {availableEnvs.map((e) => (
                  <button
                    key={e}
                    onClick={() => setEnv(e)}
                    className={[
                      "rounded-md border px-3 py-1.5 text-xs",
                      env === e
                        ? "border-sky-500 bg-sky-500/10 text-sky-300"
                        : "border-slate-700 text-slate-300 hover:bg-slate-800",
                    ].join(" ")}
                  >
                    {e === "dev" ? "개발 DB" : "운영 DB"}
                  </button>
                ))}
              </div>

              <textarea
                value={sql}
                onChange={(e) => setSql(e.target.value)}
                rows={4}
                placeholder="SELECT * FROM users"
                spellCheck={false}
                className="mb-3 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-sm text-slate-100 outline-none focus:border-sky-500"
              />

              <button
                onClick={handleRun}
                disabled={running || !sql.trim()}
                className="mb-4 rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
              >
                {running ? "조회 중..." : "실행"}
              </button>

              {error && <p className="mb-3 text-xs text-rose-400">{error}</p>}

              {result && (
                <div>
                  <p className="mb-2 text-xs text-slate-500">
                    {result.rowCount}행{result.truncated ? " (500행까지만 표시됨)" : ""}
                    {autoLimited && ` (LIMIT ${DEFAULT_LIMIT} 자동 적용됨)`}
                    {" · 드래그로 범위 선택 후 Ctrl+C로 복사"}
                    {copiedFlash && <span className="ml-2 text-sky-400">복사됨</span>}
                  </p>
                  <div className="overflow-auto rounded-md border border-slate-700">
                    <table className="min-w-full select-none text-left text-xs">
                      <thead className="bg-slate-800 text-slate-300">
                        <tr>
                          {result.columns.map((c) => (
                            <th key={c} className="whitespace-nowrap px-2 py-1.5 font-medium">
                              {c}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {result.rows.map((row, i) => (
                          <tr key={i} className="border-t border-slate-800 text-slate-200">
                            {row.map((cell, j) => (
                              <td
                                key={j}
                                onMouseDown={(e) => handleCellMouseDown(i, j, e)}
                                onMouseEnter={() => dragging && setSelEnd({ r: i, c: j })}
                                title="드래그로 범위 선택 후 Ctrl+C로 복사"
                                className={[
                                  "max-w-[240px] cursor-cell px-2 py-1.5",
                                  isSelected(i, j) ? "bg-sky-500/30" : "hover:bg-slate-800/60",
                                ].join(" ")}
                              >
                                <div className="truncate">
                                  {cell === null ? <span className="text-slate-600">NULL</span> : formatCell(cell)}
                                </div>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
