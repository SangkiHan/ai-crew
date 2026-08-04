import { homedir } from "node:os";
import { join } from "node:path";

// Antigravity CLI(agy) 공식 설치 스크립트가 쓰는 고정 설치 경로. 설치 스크립트가 사용자
// PATH(레지스트리/셸 rc)에도 등록하지만, 이미 떠 있던 프로세스(이 러너를 포함)는 설치
// *이후*에 바뀐 PATH를 넘겨받지 못한다 - Node의 child_process.spawn은 부모 프로세스가
// 생성될 때 물려받은 env를 그대로 자식에 전달할 뿐, 레지스트리를 다시 읽지 않는다.
// 그래서 "분명히 설치했는데 설치 안 됨으로 뜬다"는 문제가 실제로 반복됐다(러너를 재시작해도
// 재시작한 셸 자체가 오래된 세션이면 마찬가지). agy를 spawn할 때마다 이 경로를 PATH에
// 보강해두면, 러너를 껐다 켤 필요도, 컴퓨터를 재부팅할 필요도 없이 항상 찾아진다.
// 실제로 설치되어 있지 않으면 이 경로를 더해도 spawn은 여전히 ENOENT로 정직하게 실패한다.
function knownAgyBinDir(): string | null {
  if (process.platform === "win32") {
    // 예: C:\Users\<user>\AppData\Local\agy\bin\agy.exe
    return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "agy", "bin");
  }
  // macOS/Linux 설치 스크립트는 ~/.local/bin/agy에 둔다.
  return join(homedir(), ".local", "bin");
}

// agy를 spawn할 때 쓸 env. PATH에 알려진 설치 경로가 이미 있으면 중복 추가하지 않는다.
//
// 주의: `{ ...process.env, PATH: ... }` 식으로 스프레드하면 실수하기 쉽다. Windows는 환경변수
// 키가 대소문자 무관인데(PATH/Path/path 전부 같은 변수), Node의 process.env는 이걸 내부
// Proxy로 흡수해서 감춰준다 - 하지만 스프레드는 그 Proxy를 거치지 않고 실제 소유 키(보통
// 이 프로세스를 스폰한 셸에 따라 "Path" 또는 "PATH")만 그대로 복사한다. 거기에 새 키
// "PATH"(대문자 고정)를 얹으면 원래 키와 별개로 공존하게 되고, cross-spawn이 무엇을 먼저
// 찾느냐에 따라 방금 추가한 값이 조용히 무시될 수 있다 - 실제로 이 문제로 agy가 계속
// "설치 안 됨"으로 잘못 나온 적이 있다. 그래서 기존에 실제로 존재하는 PATH류 키를 대소문자
// 무관하게 찾아 그 키에만 이어붙인다 - 새 키를 만들지 않는다.
export function envWithAgyPath(): NodeJS.ProcessEnv {
  const dir = knownAgyBinDir();
  if (!dir) return process.env;
  const existingKey = Object.keys(process.env).find((k) => k.toLowerCase() === "path") ?? "PATH";
  const currentPath = process.env[existingKey] ?? "";
  if (currentPath.toLowerCase().includes(dir.toLowerCase())) return process.env;
  const separator = process.platform === "win32" ? ";" : ":";
  return { ...process.env, [existingKey]: `${dir}${separator}${currentPath}` };
}
