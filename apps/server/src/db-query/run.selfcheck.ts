// SELECT-only 검증/연결 문자열 조합 로직만 떼서 확인하는 self-check. `tsx src/db-query/run.selfcheck.ts`로 실행.
import { assertSelectOnly, buildConnectionString } from "./run.js";

function expectOk(sql: string) {
  assertSelectOnly(sql);
}
function expectRejected(sql: string) {
  try {
    assertSelectOnly(sql);
    throw new Error(`거부됐어야 하는데 통과함: ${sql}`);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("거부됐어야")) throw err;
  }
}

expectOk("SELECT * FROM users WHERE created_at > now()");
expectOk("select id, updated_at from orders");
expectOk("WITH recent AS (SELECT * FROM users) SELECT * FROM recent");
expectOk("  SELECT 1;  ");

expectRejected("UPDATE users SET name = 'x'");
expectRejected("SELECT * FROM users; DROP TABLE users;");
expectRejected("INSERT INTO users VALUES (1)");
expectRejected("DELETE FROM users");
expectRejected("SELECT * INTO backup FROM users");
expectRejected("SELECT * FROM users FOR UPDATE");
expectRejected("CREATE TABLE x (id int)");
expectRejected("");

function assertEqual(actual: string, expected: string) {
  if (actual !== expected) throw new Error(`기대값 불일치: ${actual} !== ${expected}`);
}

assertEqual(
  buildConnectionString("postgresql://localhost:5432/mydb", "myuser", "p@ss:word"),
  "postgresql://myuser:p%40ss%3Aword@localhost:5432/mydb"
);
assertEqual(buildConnectionString("mysql://db.internal:3306/appdb"), "mysql://db.internal:3306/appdb");
assertEqual(
  buildConnectionString("mysql://db.internal:3306/appdb", "root", null),
  "mysql://root@db.internal:3306/appdb"
);
assertEqual(
  buildConnectionString(
    "jdbc:postgresql://iotp-az-sql.postgres.database.azure.com:5432/iotpx?serverTimezone=Asia/Seoul&cacheDefaultTimezone=false",
    "tnm_iotp",
    "kL8W3m?X7PcT@rG"
  ),
  "postgresql://tnm_iotp:kL8W3m%3FX7PcT%40rG@iotp-az-sql.postgres.database.azure.com:5432/iotpx?serverTimezone=Asia/Seoul&cacheDefaultTimezone=false"
);

console.log("db-query run.selfcheck: OK");
