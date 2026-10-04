import { registerLiveAdapter } from "./registry";
import { OpenAiAdapter } from "./openai";
import type { ReasoningEffort } from "./openai";
import { PerplexityAdapter } from "./perplexity";
import { ClaudeAdapter } from "./claude";
import { GrokAdapter } from "./grok";

/**
 * Подключение живых адаптеров.
 *
 * Вызывается приложениями явно, а не при импорте пакета: импорт `@repo/core`
 * не должен сам по себе означать готовность ходить в сеть и тратить деньги.
 * Платформа без ключа просто не регистрируется. Прогон её не спрашивает
 * (`liveAdapterPlatforms`) и пишет об этом в пояснении: раньше каждая её
 * задача падала, и любой прогон с Grok по умолчанию выглядел сбоем.
 */
let registeredPlatforms: readonly string[] = [];

/** Платформы, для которых в этом процессе подключён живой адаптер. */
export function liveAdapterPlatforms(): readonly string[] {
  return registeredPlatforms;
}

export function registerLiveAdapters(env: NodeJS.ProcessEnv = process.env): string[] {
  const registered: string[] = [];

  const openAiKey = env["OPENAI_API_KEY"]?.trim();
  if (openAiKey) {
    const model = env["OPENAI_MODEL"]?.trim();
    const effort = env["OPENAI_REASONING_EFFORT"]?.trim() as ReasoningEffort | undefined;
    registerLiveAdapter(
      "chatgpt",
      () =>
        new OpenAiAdapter({
          apiKey: openAiKey,
          ...(model ? { model } : {}),
          ...(effort ? { reasoningEffort: effort } : {}),
        }),
    );
    registered.push("chatgpt");
  }

  const perplexityKey = env["PERPLEXITY_API_KEY"]?.trim();
  if (perplexityKey) {
    const preset = env["PERPLEXITY_PRESET"]?.trim();
    const endpoint = env["PERPLEXITY_ENDPOINT"]?.trim();
    registerLiveAdapter(
      "perplexity",
      () =>
        new PerplexityAdapter({
          apiKey: perplexityKey,
          ...(preset ? { preset } : {}),
          ...(endpoint ? { endpoint } : {}),
        }),
    );
    registered.push("perplexity");
  }

  /**
   * Gemini не регистрируется, даже когда ключ задан.
   *
   * Условия Google на grounded-поиск запрещают анализировать результаты,
   * собирать из них ссылки программно и строить индекс, а хранить
   * разрешают до двух лет и только ради улучшения отображения. Продукт
   * делает ровно запрещённое. Класс адаптера оставлен и покрыт тестами:
   * он верен и понадобится, если условия изменятся, — но запускать его
   * нельзя, и выключено это здесь, а не забытой галочкой в расписании.
   * Разбор условий — docs/open-questions/gemini-grounding.md.
   */

  const claudeKey = env["ANTHROPIC_API_KEY"]?.trim();
  if (claudeKey) {
    const model = env["CLAUDE_MODEL"]?.trim();
    const endpoint = env["CLAUDE_ENDPOINT"]?.trim();
    const searchTool = env["CLAUDE_SEARCH_TOOL"]?.trim();
    const maxSearches = Number(env["CLAUDE_MAX_SEARCHES"]);
    const workspaceId = env["ANTHROPIC_WORKSPACE_ID"]?.trim();
    registerLiveAdapter(
      "claude",
      () =>
        new ClaudeAdapter({
          apiKey: claudeKey,
          ...(model ? { model } : {}),
          ...(endpoint ? { endpoint } : {}),
          ...(searchTool ? { searchTool } : {}),
          ...(Number.isInteger(maxSearches) && maxSearches > 0 ? { maxSearches } : {}),
          ...(workspaceId ? { workspaceId } : {}),
        }),
    );
    registered.push("claude");
  }

  const grokKey = env["XAI_API_KEY"]?.trim();
  if (grokKey) {
    const model = env["GROK_MODEL"]?.trim();
    const endpoint = env["GROK_ENDPOINT"]?.trim();
    registerLiveAdapter(
      "grok",
      () =>
        new GrokAdapter({
          apiKey: grokKey,
          ...(model ? { model } : {}),
          ...(endpoint ? { endpoint } : {}),
        }),
    );
    registered.push("grok");
  }

  registeredPlatforms = registered;
  return registered;
}
