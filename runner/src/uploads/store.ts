import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ChatImage } from "@ai-crew/shared";

// 워크트리 안이 아니라 별도 폴더에 영구 저장한다 - 팀장이 이 경로를 그대로 직원 티켓의
// spec에 적어줘도, 그 워크트리가 나중에 지워진 뒤에도 이미지는 계속 남아있어야 하므로.
const UPLOADS_ROOT = join(homedir(), ".ai-crew", "uploads");

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

function extensionFor(image: ChatImage): string {
  if (image.name.includes(".")) return image.name.slice(image.name.lastIndexOf("."));
  return EXTENSION_BY_MIME[image.mimeType] ?? "";
}

// 첨부 이미지를 호스트 파일로 저장하고 절대경로 목록을 반환한다. 팀장/직원 모두 Read 툴로
// 이 경로를 열어 이미지를 볼 수 있다 (Claude Code의 Read는 이미지 파일을 멀티모달로 읽는다).
export async function saveUploadedImages(teamId: string, images: ChatImage[]): Promise<string[]> {
  if (images.length === 0) return [];
  const dir = join(UPLOADS_ROOT, teamId);
  await mkdir(dir, { recursive: true });

  const paths: string[] = [];
  for (const image of images) {
    const path = join(dir, `${randomUUID()}${extensionFor(image)}`);
    await writeFile(path, Buffer.from(image.dataBase64, "base64"));
    paths.push(path);
  }
  return paths;
}
