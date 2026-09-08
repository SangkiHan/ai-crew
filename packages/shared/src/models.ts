import type { Driver } from "./agent.js";

export interface DriverModelOption {
  value: string;
  label: string;
}

// CLI가 `--model`로 받을 수 있는 현행 모델/별칭만 관리한다. 이 목록은 각 CLI의 공개 모델
// 카탈로그가 바뀔 때 갱신하며, 저장된 예전 값은 UI에서 별도로 보존한다.
export const DRIVER_MODEL_OPTIONS: Record<Exclude<Driver, "mock">, DriverModelOption[]> = {
  claude: [
    { value: "fable", label: "Fable" },
    { value: "opus", label: "Opus" },
    { value: "sonnet", label: "Sonnet" },
  ],
  // Antigravity CLI(agy)는 --model에 전체 모델 이름을 받는다. 여기 목록은 `agy models` 실행
  // 결과 그대로다 - 예전에 쓰던 "gemini-3-pro" 같은 이름은 지금 설치된 agy가 인식 못 해
  // 즉시 실패했다. CLI가 업데이트되면 이 목록도 `agy models`로 다시 확인해서 맞춰야 한다.
  antigravity: [
    { value: "gemini-3.8-flash-high", label: "Gemini 3.8 Flash (High)" },
    { value: "gemini-3.8-flash-medium", label: "Gemini 3.8 Flash (Medium)" },
    { value: "gemini-3.8-flash-low", label: "Gemini 3.8 Flash (Low)" },
    { value: "gemini-3.7-flash-high", label: "Gemini 3.7 Flash (High)" },
    { value: "gemini-3.7-flash-medium", label: "Gemini 3.7 Flash (Medium)" },
    { value: "gemini-3.7-flash-low", label: "Gemini 3.7 Flash (Low)" },
    { value: "gemini-3.6-flash-high", label: "Gemini 3.6 Flash (High)" },
    { value: "gemini-3.6-flash-medium", label: "Gemini 3.6 Flash (Medium)" },
    { value: "gemini-3.6-flash-low", label: "Gemini 3.6 Flash (Low)" },
    { value: "gemini-3.1-pro-high", label: "Gemini 3.1 Pro (High)" },
    { value: "gemini-3.1-pro-low", label: "Gemini 3.1 Pro (Low)" },
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (Thinking)" },
    { value: "claude-opus-4-6-thinking", label: "Claude Opus 4.6 (Thinking)" },
    { value: "gpt-oss-120b-medium", label: "GPT-OSS 120B (Medium)" },
  ],
  // ChatGPT 계정으로 로그인한 codex는 API 전용 모델 이름을 거부한다("model is not supported
  // when using Codex with a ChatGPT account") - 직접 실행해서 이 두 개만 통과하는 걸 확인했다.
  // API 키 인증을 쓰는 환경이면 더 많은 모델이 될 수 있으니, 계정 방식이 바뀌면 재확인이 필요하다.
  codex: [
    { value: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
    { value: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
  ],
};

export function isKnownDriverModel(driver: Driver, model: string | undefined): boolean {
  if (!model) return true;
  if (driver === "mock") return false;
  return DRIVER_MODEL_OPTIONS[driver].some((option) => option.value === model);
}
