import { env, pipeline, type FeatureExtractionPipeline } from "@xenova/transformers";

// 로컬(온디바이스) 임베딩 모델 - 별도 API 키/과금 없이 컨테이너 안에서 바로 돈다
// (이 프로젝트가 claude/gemini/codex CLI 구독 요금제만 쓰고 API 과금을 피하는 것과 같은 이유).
// all-MiniLM-L6-v2는 384차원의 작고 검증된 문장 임베딩 모델이다.
const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_DIMENSIONS = 384;

// 모델 파일(~90MB)을 컨테이너 재시작/재빌드마다 다시 받지 않도록 캐시 경로를 고정한다
// (infra/docker-compose.yml에서 이 경로를 볼륨으로 마운트한다).
env.cacheDir = process.env.TRANSFORMERS_CACHE ?? "/tmp/transformers-cache";

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", MODEL_NAME) as Promise<FeatureExtractionPipeline>;
  }
  return extractorPromise;
}

export async function embed(text: string): Promise<number[]> {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}
