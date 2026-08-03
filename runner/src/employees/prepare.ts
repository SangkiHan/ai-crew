import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Employee, RunnerToServerEvent, Ticket } from "@ai-crew/shared";
import { currentBranch, currentHeadSha } from "../git.js";
import { projectPath } from "../workspace.js";
import { fetchPendingPeerMessages, reportQaFallback } from "./api.js";
import { buildEmployeePrompt, formatPendingPeerMessages } from "./prompt.js";

export interface PreparedJob {
  cwd: string;
  message: string;
  systemPrompt: string;
  baseSha: string | null;
}

// 프로젝트 실제 폴더에서 직접 작업하므로(격리된 워크트리 없음), 드라이버 pid 같은 러너 내부
// 상태 파일을 그 폴더 안에 두면 안 된다 - 사용자의 실제 저장소에 낯선 파일이 섞여 들어간다.
// 대신 러너 전용 상태 디렉터리에 티켓 id로 키를 잡아 보관한다.
const STATE_ROOT = join(homedir(), ".ai-crew", "state");

function driverPidFile(ticketId: string): string {
  return join(STATE_ROOT, `${ticketId}.pid`);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// 러너가 재시작(개발 중 코드 수정에 의한 tsx watch 재시작, 또는 크래시 후 재기동)되면
// recoverAndAssign이 "running" 티켓을 다시 밀어준다. 이전 러너가 띄운 CLI 프로세스는
// 부모(러너)가 죽어도 자동으로 안 죽고 고아 프로세스로 계속 돌아가는 경우가 있어서, 확인 없이
// 새 세션을 또 띄우면 같은 티켓에 여러 프로세스가 동시에 도는 사고가 난다 (실제로 겪음).
// 새로 시작하기 전에 이전 프로세스가 살아있는지 확인하고 정리한다.
async function killStaleDriverProcess(ticketId: string): Promise<void> {
  try {
    const raw = await readFile(driverPidFile(ticketId), "utf-8");
    const pid = Number(raw.trim());
    if (pid && isAlive(pid)) {
      console.log(`[runner] 이전 세션(pid ${pid})이 아직 살아있어 정리합니다 (ticket ${ticketId})`);
      process.kill(pid, "SIGTERM");
    }
  } catch {
    // pid 파일이 없으면 이전 세션이 없었다는 뜻 - 정상.
  }
}

export async function writeDriverPid(ticketId: string, pid: number | null | undefined): Promise<void> {
  if (!pid) return;
  await mkdir(STATE_ROOT, { recursive: true }).catch(() => {});
  await writeFile(driverPidFile(ticketId), String(pid)).catch(() => {});
}

export async function clearDriverPid(ticketId: string): Promise<void> {
  await unlink(driverPidFile(ticketId)).catch(() => {});
}

function toDisallowedBashPatterns(requireApproval: string[]): string[] {
  return requireApproval.map((cmd) => `Bash(${cmd}:*)`);
}

// claude/gemini/codex 드라이버가 공유하는 준비 단계: 프로젝트 실제 폴더를 cwd로 확인,
// 미답변 동료 메시지 포함, 시스템 프롬프트 생성. CLI마다 실제 spawn 방식/플래그만 다르다.
// 사용자 결정: 격리된 워크트리/새 브랜치를 만들지 않고 프로젝트 실제 폴더의 현재 체크아웃된
// 브랜치에 직접 작업한다 - 같은 프로젝트에 티켓이 동시에 여러 개 돌면 서로 파일을 건드릴 수
// 있다는 걸 사용자가 인지하고 선택한 트레이드오프다.
export async function prepareEmployeeJob(
  ticket: Ticket,
  employee: Employee,
  send: (event: RunnerToServerEvent) => void
): Promise<PreparedJob> {
  const now = () => new Date().toISOString();

  if (ticket.status === "assigned") {
    send({ type: "job_status", ticketId: ticket.id, status: "running" });
  }

  const cwd = projectPath(ticket.project);
  await killStaleDriverProcess(ticket.id);

  const [branch, baseSha] = await Promise.all([currentBranch(cwd), currentHeadSha(cwd)]);
  send({ type: "job_meta", ticketId: ticket.id, branch: branch ?? undefined, baseSha: baseSha ?? undefined });
  send({
    type: "job_log",
    ticketId: ticket.id,
    line: `[${employee.name}] 작업 시작: ${cwd} (브랜치: ${branch ?? "확인 안 됨"})`,
    ts: now(),
  });

  const pendingPeerMessages = await fetchPendingPeerMessages(employee.name).catch(() => []);
  // QA가 반려해서 재작업하는 경우, QA가 남긴 사유를 티켓 본문보다 먼저 보여준다.
  const qaContext = ticket.qaNote
    ? `## QA 반려 사유 (${ticket.qaCycles}회차)\n\n${ticket.qaNote}\n\n위 내용을 확인하고 수정해주세요.\n\n---\n\n`
    : "";
  const message = `${qaContext}## 티켓: ${ticket.title}\n\n${ticket.spec}${formatPendingPeerMessages(pendingPeerMessages)}`;

  return { cwd, message, systemPrompt: buildEmployeePrompt(employee), baseSha };
}

// QA 검증 단계 전용 준비 함수. 개발자가 작업한 것과 같은 프로젝트 실제 폴더를 그대로 쓴다 -
// QA는 실제로 그 코드를 리뷰/테스트해야 하므로 격리된 새 폴더가 아니라 바로 그 결과물을 봐야 한다.
export async function prepareQaJob(
  ticket: Ticket,
  qaEmployee: Employee,
  send: (event: RunnerToServerEvent) => void
): Promise<PreparedJob> {
  const cwd = projectPath(ticket.project);
  await killStaleDriverProcess(ticket.id);
  send({
    type: "job_log",
    ticketId: ticket.id,
    line: `[${qaEmployee.name}] QA 검증 시작: ${cwd}`,
    ts: new Date().toISOString(),
  });

  const message =
    `## QA 검증 요청\n\n다음 티켓의 구현 결과를 검증하세요.\n\n` +
    `### 원래 티켓: ${ticket.title}\n${ticket.spec}\n\n` +
    `이 프로젝트(${cwd})에 이미 구현이 완료되어 있습니다. 코드를 리뷰하고, ` +
    `가능하면 실제로 빌드/테스트를 실행해서 요구사항대로 동작하는지 확인하세요. ` +
    `문제가 없으면 report_qa_result 툴로 pass:true를, 문제가 있으면 pass:false와 ` +
    `구체적인 수정 지시(무엇을 어떻게 고쳐야 하는지)를 note에 담아 호출하세요. ` +
    `직접 코드를 고치지 마세요 - 검증과 판정만 하는 역할입니다.`;

  return { cwd, message, systemPrompt: buildEmployeePrompt(qaEmployee), baseSha: ticket.baseSha };
}

// QA 세션이 끝났는데 report_qa_result를 안 불렀으면(세션이 그냥 종료됨) 안전망으로 통과 처리한다.
export function reportQaFallbackIfNeeded(ticket: Ticket): void {
  reportQaFallback(ticket.id).catch(() => {});
}

export interface DriverResult {
  success: boolean;
  resultText: string;
  sessionId?: string;
}

export function reportDriverResult(
  ticket: Ticket,
  employee: Employee,
  result: DriverResult,
  send: (event: RunnerToServerEvent) => void,
  diffSummary?: string
) {
  const now = () => new Date().toISOString();

  send({
    type: "job_meta",
    ticketId: ticket.id,
    sessionId: result.sessionId,
    resultText: result.resultText || "(직원이 텍스트 보고를 남기지 않았습니다)",
    diffSummary,
  });

  if (diffSummary?.startsWith("커밋 없음")) {
    send({
      type: "job_log",
      ticketId: ticket.id,
      line: `[${employee.name}] ⚠️ ${diffSummary}`,
      ts: now(),
    });
  }

  if (result.success) {
    // report_blocked를 이미 호출했다면 티켓은 REST 경로로 곧장 "blocked"가 되어 있고,
    // 여기서 "review"로 보내려는 시도는 유효하지 않은 전이라 서버에서 조용히 거부된다.
    send({ type: "job_status", ticketId: ticket.id, status: "review" });
  } else {
    send({
      type: "job_log",
      ticketId: ticket.id,
      line: `[${employee.name}] 실패: ${result.resultText || "(사유 없음)"}`,
      ts: now(),
    });
    send({ type: "job_status", ticketId: ticket.id, status: "failed" });
  }
}

export { toDisallowedBashPatterns };
