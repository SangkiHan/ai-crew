import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Employee, RunnerToServerEvent, Ticket } from "@ai-crew/shared";
import { createWorktree } from "../worktree.js";
import { projectPath } from "../workspace.js";
import { fetchPendingPeerMessages, reportQaFallback } from "./api.js";
import { buildEmployeePrompt, formatPendingPeerMessages } from "./prompt.js";

export interface PreparedJob {
  worktreePath: string;
  message: string;
  systemPrompt: string;
}

function driverPidFile(worktreePath: string): string {
  return join(worktreePath, ".ai-crew-driver.pid");
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
async function killStaleDriverProcess(worktreePath: string): Promise<void> {
  try {
    const raw = await readFile(driverPidFile(worktreePath), "utf-8");
    const pid = Number(raw.trim());
    if (pid && isAlive(pid)) {
      console.log(`[runner] 이전 세션(pid ${pid})이 아직 살아있어 정리합니다: ${worktreePath}`);
      process.kill(pid, "SIGTERM");
    }
  } catch {
    // pid 파일이 없으면 이전 세션이 없었다는 뜻 - 정상.
  }
}

export async function writeDriverPid(worktreePath: string, pid: number | null | undefined): Promise<void> {
  if (!pid) return;
  await writeFile(driverPidFile(worktreePath), String(pid)).catch(() => {});
}

export async function clearDriverPid(worktreePath: string): Promise<void> {
  await unlink(driverPidFile(worktreePath)).catch(() => {});
}

function toDisallowedBashPatterns(requireApproval: string[]): string[] {
  return requireApproval.map((cmd) => `Bash(${cmd}:*)`);
}

// claude/gemini/codex 드라이버가 공유하는 준비 단계: worktree 생성, 미답변 동료 메시지 포함,
// 시스템 프롬프트 생성. CLI마다 실제 spawn 방식/플래그만 다르다.
export async function prepareEmployeeJob(
  ticket: Ticket,
  employee: Employee,
  send: (event: RunnerToServerEvent) => void
): Promise<PreparedJob> {
  const now = () => new Date().toISOString();

  if (ticket.status === "assigned") {
    send({ type: "job_status", ticketId: ticket.id, status: "running" });
  }

  const { worktreePath } = await createWorktree(projectPath(ticket.project), ticket.project, ticket.id);
  await killStaleDriverProcess(worktreePath);
  send({ type: "job_meta", ticketId: ticket.id, worktreePath });
  send({
    type: "job_log",
    ticketId: ticket.id,
    line: `[${employee.name}] worktree 준비 완료: ${worktreePath}`,
    ts: now(),
  });

  const pendingPeerMessages = await fetchPendingPeerMessages(employee.name).catch(() => []);
  // QA가 반려해서 재작업하는 경우, QA가 남긴 사유를 티켓 본문보다 먼저 보여준다.
  const qaContext = ticket.qaNote
    ? `## QA 반려 사유 (${ticket.qaCycles}회차)\n\n${ticket.qaNote}\n\n위 내용을 확인하고 수정해주세요.\n\n---\n\n`
    : "";
  const message = `${qaContext}## 티켓: ${ticket.title}\n\n${ticket.spec}${formatPendingPeerMessages(pendingPeerMessages)}`;

  return { worktreePath, message, systemPrompt: buildEmployeePrompt(employee.taskDescription) };
}

// QA 검증 단계 전용 준비 함수. 새 워크트리를 만들지 않고 개발자가 이미 작업한 워크트리를
// 그대로 재사용한다 - QA는 실제로 그 코드를 리뷰/테스트해야 하므로 격리된 새 폴더가 아니라
// 바로 그 결과물을 봐야 한다.
export async function prepareQaJob(
  ticket: Ticket,
  qaEmployee: Employee,
  send: (event: RunnerToServerEvent) => void
): Promise<PreparedJob> {
  if (!ticket.worktreePath) {
    throw new Error(`QA 검증할 워크트리가 없습니다 (ticket ${ticket.id})`);
  }
  await killStaleDriverProcess(ticket.worktreePath);
  send({
    type: "job_log",
    ticketId: ticket.id,
    line: `[${qaEmployee.name}] QA 검증 시작: ${ticket.worktreePath}`,
    ts: new Date().toISOString(),
  });

  const message =
    `## QA 검증 요청\n\n다음 티켓의 구현 결과를 검증하세요.\n\n` +
    `### 원래 티켓: ${ticket.title}\n${ticket.spec}\n\n` +
    `이 워크트리(${ticket.worktreePath})에 이미 구현이 완료되어 있습니다. 코드를 리뷰하고, ` +
    `가능하면 실제로 빌드/테스트를 실행해서 요구사항대로 동작하는지 확인하세요. ` +
    `문제가 없으면 report_qa_result 툴로 pass:true를, 문제가 있으면 pass:false와 ` +
    `구체적인 수정 지시(무엇을 어떻게 고쳐야 하는지)를 note에 담아 호출하세요. ` +
    `직접 코드를 고치지 마세요 - 검증과 판정만 하는 역할입니다.`;

  return { worktreePath: ticket.worktreePath, message, systemPrompt: buildEmployeePrompt(qaEmployee.taskDescription) };
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
  send: (event: RunnerToServerEvent) => void
) {
  const now = () => new Date().toISOString();

  if (result.sessionId) {
    send({ type: "job_meta", ticketId: ticket.id, sessionId: result.sessionId });
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
