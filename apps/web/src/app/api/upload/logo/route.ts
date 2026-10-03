import { headers } from "next/headers";
import { updateAgency } from "@repo/db";
import { logoKey, validateLogoUpload } from "@repo/core/storage/types";
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

  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return Response.json({ error: "No file provided" }, { status: 400 });
  }

  const validation = validateLogoUpload(file.type, file.size);
  if (!validation.ok) {
    return Response.json({ error: validation.error }, { status: 400 });
  }

  const extension = EXTENSION_BY_TYPE[file.type] ?? "png";
  const key = logoKey(user.agencyId, extension);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const url = await storage.put(key, bytes, file.type);

  // Кэш-бастер: путь стабильный, поэтому браузер иначе покажет старый логотип.
  await updateAgency(db, user.agencyId, { logoUrl: `${url}?v=${Date.now()}` });

  return Response.json({ url });
}
