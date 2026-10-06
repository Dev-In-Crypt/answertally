import { getAdapter, isPlatform, parseAdaptersMode } from "./registry";
import { registerLiveAdapters } from "./live";

/**
 * Ручная проверка живого адаптера: единственное место в репозитории, которое
 * действительно ходит в сеть и тратит деньги. Не тест — тесты сеть не трогают.
 *
 * Пока такой прогон не сделан, адаптер считается непроверенным: форма ответа
 * у провайдеров меняется без предупреждения, и документация от неё отстаёт.
 *
 * Запуск:
 *   ADAPTERS_MODE=live pnpm --filter @repo/worker exec tsx \
 *     ../../packages/core/src/adapters/live-check.ts chatgpt "best CRM for startups"
 */
async function main(): Promise<void> {
  const mode = parseAdaptersMode(process.env["ADAPTERS_MODE"]);
  if (mode !== "live") {
    throw new Error("Set ADAPTERS_MODE=live to run this check.");
  }

  const platform = process.argv[2] ?? "chatgpt";
  if (!isPlatform(platform)) {
    throw new Error(`Unknown platform "${platform}". Use chatgpt, perplexity, claude or grok.`);
  }

  const registered = registerLiveAdapters();
  if (!registered.includes(platform)) {
    throw new Error(`No API key for "${platform}", so there is nothing to check.`);
  }

  const prompt = process.argv[3] ?? "best CRM for startups";
  const result = await getAdapter(platform, "live").execute(prompt);

  console.log(
    JSON.stringify(
      {
        platform,
        prompt,
        modelVersion: result.modelVersion,
        costUsd: result.costUsd,
        latencyMs: result.latencyMs,
        citations: result.citations.length,
        domains: [...new Set(result.citations.map((c) => new URL(c.url).hostname))],
        textHead: result.text.slice(0, 200),
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
