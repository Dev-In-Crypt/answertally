import { headers } from "next/headers";
import { updateAgency } from "@repo/db";
import {
  logoKey,
  MAX_LOGO_BYTES,
  sniffImageType,
  validateLogoUpload,
} from "@repo/core/storage/types";
import { auth } from "@/lib/auth";
import { storage } from "@/server/storage";
import { db } from "@/server/db";

const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  const user = session?.user as ({ agencyId?: string; role?: string } & object) | undefined;

  if (!user?.agencyId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role === "member") {
    return Response.json({ error: "Only admins can change branding" }, { status: 403 });
  }

  // Размер — до разбора формы: иначе сервер сначала читал бы в память
  // тело любого объёма, а потом отказывал. Запас сверх лимита — на обвязку
  // multipart.
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declared) || declared > MAX_LOGO_BYTES + 64 * 1024) {
    return Response.json({ error: "Keep the logo under 2 MB." }, { status: 413 });
  }

  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return Response.json({ error: "No file provided" }, { status: 400 });
  }

  const validation = validateLogoUpload(file.type, file.size);
  if (!validation.ok) {
    return Response.json({ error: validation.error }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffImageType(bytes);
  if (sniffed !== file.type) {
    return Response.json({ error: "Use a PNG, JPEG, WebP or SVG image." }, { status: 400 });
  }

  const extension = EXTENSION_BY_TYPE[sniffed] ?? "png";
  const key = logoKey(user.agencyId, extension);
  const url = await storage.put(key, bytes, sniffed);

  // Кэш-бастер: путь стабильный, поэтому браузер иначе покажет старый логотип.
  await updateAgency(db, user.agencyId, { logoUrl: `${url}?v=${Date.now()}` });

  return Response.json({ url });
}
