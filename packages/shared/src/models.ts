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
  gemini: [
    { value: "auto", label: "Auto" },
    { value: "pro", label: "Pro" },
    { value: "flash", label: "Flash" },
    { value: "flash-lite", label: "Flash Lite" },
    { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (Preview)" },
    { value: "gemini-3-pro-preview", label: "Gemini 3 Pro (Preview)" },
    { value: "gemini-3-flash-preview", label: "Gemini 3 Flash (Preview)" },
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
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
