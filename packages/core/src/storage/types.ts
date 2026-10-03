/**
 * Контракт хранилища файлов. Реализации живут в приложениях (I/O за границей core):
 * локальный диск для разработки, S3-совместимое хранилище в проде.
 * Сюда складываются логотипы агентств, raw-ответы платформ (T17) и PDF отчётов (T53).
 */
export interface StoredObject {
  bytes: Uint8Array;
  contentType: string;
}

export interface StorageAdapter {
  /** Кладёт объект и возвращает публичный путь для отдачи. */
  put(key: string, bytes: Uint8Array, contentType: string): Promise<string>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/svg+xml", "image/webp"]);

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export interface UploadValidationResult {
  ok: boolean;
  error?: string;
}

/** Чистая валидация загружаемого логотипа — тестируется без файловой системы. */
export function validateLogoUpload(
  contentType: string,
  byteLength: number,
): UploadValidationResult {
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
    return { ok: false, error: "Use a PNG, JPEG, WebP or SVG image." };
  }
  if (byteLength <= 0) {
    return { ok: false, error: "The file is empty." };
  }
  if (byteLength > MAX_LOGO_BYTES) {
    return { ok: false, error: "Keep the logo under 2 MB." };
  }
  return { ok: true };
}

/**
 * Тип картинки по её первым байтам, а не по тому, что назвал браузер.
 *
 * Тип из формы задаёт сам загружающий: файл другого формата под именем PNG
 * проходил проверку и потом отдавался и печатался как картинка. `null` —
 * ни один из разрешённых форматов.
 */
export function sniffImageType(bytes: Uint8Array): string | null {
  const starts = (...sig: number[]) => sig.every((byte, i) => bytes[i] === byte);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  // RIFF....WEBP
  if (
    starts(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  const head = new TextDecoder().decode(bytes.slice(0, 512)).trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) {
    return "image/svg+xml";
  }
  return null;
}

/** Ключ объекта всегда несёт agencyId — файлы разных тенантов не пересекаются. */
export function logoKey(agencyId: string, extension: string): string {
  return `agencies/${agencyId}/logo.${extension}`;
}
