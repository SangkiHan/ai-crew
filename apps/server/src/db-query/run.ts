import pg from "pg";
import mysql from "mysql2/promise";
import type { DbQueryResult } from "@ai-crew/shared";

// 결과를 이 개수로 잘라 화면/AI 컨텍스트가 거대한 테이블에 눌리는 걸 막는다. DB 서버 쪽 부하까지
// 줄이려면 SQL에 LIMIT을 주입해야 하는데, 사용자가 이미 LIMIT/ORDER BY/UNION 등을 쓴 임의의
// SELECT를 안전하게 재작성하기 어려워 응답만 자른다.
// ponytail: 클라이언트 측 truncate만 함. 대형 테이블 전체 스캔이 실제로 문제되면 SQL 파서로
// LIMIT을 주입하거나 커서 기반 스트리밍으로 바꿀 것.
const MAX_ROWS = 500;
const STATEMENT_TIMEOUT_MS = 10_000;

// 조회 전용 기능이므로 SELECT(및 CTE인 WITH ... SELECT) 외에는 전부 거부한다. 사람이 실수로
// prod DB에 쓰기 구문을 날리는 걸 막는 안전장치이지, 적대적 입력을 막는 보안 경계는 아니다
// (연결 정보 자체를 등록할 수 있는 사람은 이미 이 DB에 접근 권한이 있는 사람).
export function assertSelectOnly(sqlRaw: string): string {
  const sql = sqlRaw.trim();
  if (!sql) throw new Error("쿼리가 비어 있습니다");

  const withoutTrailingSemi = sql.replace(/;\s*$/, "");
  if (withoutTrailingSemi.includes(";")) {
    throw new Error("세미콜론으로 구분된 여러 statement는 실행할 수 없습니다 (SELECT 하나만)");
  }

  const firstWord = withoutTrailingSemi.match(/^\s*(\w+)/)?.[1]?.toLowerCase();
  if (firstWord !== "select" && firstWord !== "with") {
    throw new Error("SELECT 조회만 허용됩니다");
  }

  const FORBIDDEN =
    /\b(insert|update|delete|alter|create|drop|truncate|grant|revoke|replace|merge|call|exec|execute|vacuum|copy|into|lock|for\s+update|for\s+share)\b/i;
  const match = withoutTrailingSemi.match(FORBIDDEN);
  if (match) {
    throw new Error(`SELECT 조회만 허용됩니다 ("${match[0]}" 구문이 감지됨)`);
  }

  return withoutTrailingSemi;
}

// 팀 설정 화면은 url(호스트/포트/db명, 자격증명 없이)과 username/password를 3칸으로 나눠 받는다
// - URL 안에 통으로 넣는 것보다 익숙한 입력 형태라서다. WHATWG URL의 username/password setter가
// 특수문자를 알아서 퍼센트 인코딩해주므로 직접 문자열을 이어붙이지 않는다.
// application.yml의 spring.datasource.url을 그대로 붙여넣는 경우가 많아 "jdbc:" 접두사를
// 허용한다(예: jdbc:postgresql://host:5432/db?serverTimezone=Asia/Seoul) - 뒤에 붙는 JDBC
// 전용 쿼리 파라미터는 pg/mysql2가 모르는 키를 그냥 무시하므로 굳이 걸러내지 않는다.
export function buildConnectionString(baseUrl: string, username?: string | null, password?: string | null): string {
  const normalized = baseUrl.replace(/^jdbc:/i, "");
  if (!username && !password) return normalized;
  const url = new URL(normalized);
  if (username) url.username = username;
  if (password) url.password = password;
  return url.toString();
}

function truncate(columns: string[], rows: unknown[][]): DbQueryResult {
  const truncated = rows.length > MAX_ROWS;
  return { columns, rows: truncated ? rows.slice(0, MAX_ROWS) : rows, rowCount: rows.length, truncated };
}

async function runPostgresOnce(url: string, sql: string, forceSsl: boolean): Promise<DbQueryResult> {
  const client = new pg.Client({
    connectionString: url,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    connectionTimeoutMillis: 5_000,
    // URL에 sslmode 등이 이미 있으면 pg-connection-string이 그 값으로 이 옵션을 덮어쓴다
    // (connection-parameters.js가 connectionString 파싱 결과를 나중에 merge함) - 그러니 여기서
    // 무조건 켜도 사용자가 명시한 sslmode=disable 등을 어기지 않는다.
    ...(forceSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  await client.connect();
  try {
    const result = await client.query(sql);
    const columns = result.fields.map((f) => f.name);
    const rows = result.rows.map((row) => columns.map((c) => row[c]));
    return truncate(columns, rows);
  } finally {
    await client.end();
  }
}

// Azure/AWS 같은 관리형 Postgres는 암호화 접속만 허용하는 pg_hba 규칙(hostssl)만 두는 경우가
// 흔하다 - SSL 없이 접속하면 "no pg_hba.conf entry ... no encryption"으로 거부된다. 매번
// 사용자에게 URL에 ?sslmode=require를 붙이라고 시키는 대신, 이 특정 오류를 만나면 SSL을 켜서
// 한 번 더 시도한다 (자체 서명 인증서도 통과하도록 rejectUnauthorized:false - 이 툴은 DB
// 소유자 본인이 자기 DB를 조회하는 용도라 중간자 공격 방어보다 "일단 붙는 것"이 우선이다).
async function runPostgres(url: string, sql: string): Promise<DbQueryResult> {
  try {
    return await runPostgresOnce(url, sql, false);
  } catch (err) {
    const isSslRequiredError =
      err instanceof Error && /no pg_hba\.conf entry/.test(err.message) && /no encryption/i.test(err.message);
    if (!isSslRequiredError) throw err;
    return runPostgresOnce(url, sql, true);
  }
}

async function runMysql(url: string, sql: string): Promise<DbQueryResult> {
  const conn = await mysql.createConnection({ uri: url, connectTimeout: 5_000 });
  try {
    const [rows, fields] = await conn.query({ sql, timeout: STATEMENT_TIMEOUT_MS });
    const columns = (fields ?? []).map((f) => f.name);
    const rowArrays = (rows as Record<string, unknown>[]).map((row) => columns.map((c) => row[c]));
    return truncate(columns, rowArrays);
  } finally {
    await conn.end();
  }
}

export async function runReadOnlyQuery(dbUrl: string, sqlRaw: string): Promise<DbQueryResult> {
  const sql = assertSelectOnly(sqlRaw);
  if (dbUrl.startsWith("postgres://") || dbUrl.startsWith("postgresql://")) {
    return runPostgres(dbUrl, sql);
  }
  if (dbUrl.startsWith("mysql://")) {
    return runMysql(dbUrl, sql);
  }
  throw new Error("연결 문자열은 postgresql:// 또는 mysql://로 시작해야 합니다");
}
