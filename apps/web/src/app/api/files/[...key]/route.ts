import { storage } from "@/server/storage";
import { PUBLIC_FILE_HEADERS, publicFileType } from "@/server/public-files";

/** Отдаёт логотипы агентств — и ничего больше (см. server/public-files.ts). */
export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  const path = key.join("/");

  // Не публичное неотличимо от несуществующего (инвариант 1).
  const contentType = publicFileType(path);
  if (!contentType) {
    return new Response("Not found", { status: 404 });
  }

  const object = await storage.get(path);
  if (!object) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(object.bytes as BodyInit, {
    headers: {
      ...PUBLIC_FILE_HEADERS,
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=60",
    },
  });
}
