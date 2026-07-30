import type { RunnerToServerEvent, Ticket } from "@ai-crew/shared";

const STEPS = 3;
const STEP_DELAY_MS = 1000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 실제 claude/gemini/codex 드라이버가 붙기 전까지 티켓 파이프라인을 검증하기 위한 가짜 직원.
// 재연결로 이미 "running" 상태인 티켓을 다시 받으면 running 재전송 없이 이어서 진행한다.
export async function runMock(ticket: Ticket, send: (event: RunnerToServerEvent) => void) {
  if (ticket.status === "assigned") {
    send({ type: "job_status", ticketId: ticket.id, status: "running" });
  }

  for (let step = 1; step <= STEPS; step++) {
    await sleep(STEP_DELAY_MS);
    send({
      type: "job_log",
      ticketId: ticket.id,
      line: `[mock:${ticket.project}] step ${step}/${STEPS} - "${ticket.title}"`,
      ts: new Date().toISOString(),
    });
    send({ type: "job_heartbeat", ticketId: ticket.id, ts: new Date().toISOString() });
  }

  send({ type: "job_status", ticketId: ticket.id, status: "review" });
  await sleep(300);
  send({ type: "job_status", ticketId: ticket.id, status: "done" });
}
