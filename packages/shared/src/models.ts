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
  // Antigravity CLI(agy)는 --model에 전체 모델 이름을 받는다(예: gemini-3-pro). Gemini CLI에
  // 있던 "auto"/"pro" 같은 짧은 별칭은 agy에서 확인되지 않아 뺐다 - 미지정이 곧 자동 선택이다.
  // 정확한 현행 목록은 `agy models`로 확인할 수 있다.
  antigravity: [
    { value: "gemini-3-pro", label: "Gemini 3 Pro" },
    { value: "gemini-3-flash", label: "Gemini 3 Flash" },
    { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (Preview)" },
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  ],
  codex: [
    { value: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
    { value: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
    { value: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
    { value: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
    { value: "gpt-5.5", label: "GPT-5.5" },
    { value: "gpt-5.5-pro", label: "GPT-5.5 Pro" },
    { value: "gpt-5.4", label: "GPT-5.4" },
    { value: "gpt-5.4-pro", label: "GPT-5.4 Pro" },
    { value: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
    { value: "gpt-5.4-nano", label: "GPT-5.4 Nano" },
  ],
};

export function isKnownDriverModel(driver: Driver, model: string | undefined): boolean {
  if (!model) return true;
  if (driver === "mock") return false;
  return DRIVER_MODEL_OPTIONS[driver].some((option) => option.value === model);
}
