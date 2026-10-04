import { chromium } from "playwright";
import { storage } from "@/server/storage";

/**
 * PDF печатается из той же публичной страницы, что видит клиент.
 *
 * Отдельный шаблон для печати означал бы два документа, которые со временем
 * разойдутся: клиент прочитает одно, а в PDF уйдёт другое. Один источник —
 * одна правда, ценой запуска браузера.
 */

export function reportPdfKey(reportId: string): string {
  return `reports/${reportId}.pdf`;
}

export interface PdfOptions {
  /** Полный URL публичной страницы отчёта. */
  url: string;
  timeoutMs?: number;
}

/**
 * Браузер для печати. В разработке и тестах — тот, что ставит Playwright; в
 * боевом образе — системный Chromium, путь к нему задаёт образ. Песочница
 * Chromium внутри контейнера без root не поднимается, поэтому для системного
 * браузера она выключена: страница, которую он открывает, — наша собственная.
 */
function launchOptions() {
  const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH?.trim();
  return executablePath
    ? { executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage"] }
    : {};
}

/**
 * Печать — строго по одной на процесс.
 *
 * Каждый Chromium — сотни мегабайт; параллельные печати упирали веб в
 * предел памяти контейнера, и его убивало вместе со всеми запросами.
 * Очередь из одного медленнее, но не падает.
 */
let printing: Promise<unknown> = Promise.resolve();

/** Дольше печать не ждёт: зависший браузер держал бы очередь всех агентств. */
const RENDER_TIMEOUT_MS = 60_000;

export function renderReportPdf(options: PdfOptions): Promise<Uint8Array> {
  const next = printing.then(() => withTimeout(render(options), RENDER_TIMEOUT_MS));
  printing = next.catch(() => undefined);
  return next;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`PDF render timed out after ${ms} ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

async function render(options: PdfOptions): Promise<Uint8Array> {
  const browser = await chromium.launch(launchOptions());

  try {
    const page = await browser.newPage();
    // Браузер печати ходит только к своей странице. Логотип агентства —
    // это ссылка, которую задаёт пользователь, и без этого запрета печать
    // ходила бы по ней из серверной сети: к базе, Redis, метаданным машины.
    const origin = new URL(options.url).origin;
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin || route.request().url().startsWith("data:")
        ? route.continue()
        : route.abort(),
    );
    await page.goto(options.url, {
      waitUntil: "networkidle",
      timeout: options.timeoutMs ?? 30_000,
    });

    // Форма подтверждения в печати не нужна: на бумаге кнопка бессмысленна.
    await page.addStyleTag({
      content: `[data-testid="approve-form"] { display: none !important; }`,
    });

    return await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "16mm", bottom: "16mm", left: "12mm", right: "12mm" },
    });
  } finally {
    await browser.close();
  }
}

/** Рендерит и кладёт в хранилище, возвращая ключ. */
export async function storeReportPdf(reportId: string, url: string): Promise<string> {
  const bytes = await renderReportPdf({ url });
  const key = reportPdfKey(reportId);
  await storage.put(key, bytes, "application/pdf");
  return key;
}
