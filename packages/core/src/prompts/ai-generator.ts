import { z } from "zod";
import { postJson, defaultSleep } from "../adapters/http";
import {
  buildPromptCandidates,
  clampPromptCount,
  DEFAULT_GENERATED_PROMPT_COUNT,
  type GeneratedPrompt,
  type PromptGenerator,
  type PromptSeed,
} from "./generate";

/**
 * Вопросы покупателей, составленные моделью по сайту клиента.
 *
 * Шаблоны одинаковы для кроссовок и CRM, и первый живой аудит спросил
 * ассистентов о «best running shoes for startups». Модель видит, что
 * клиент на самом деле продаёт, кому и против кого, и пишет вопросы,
 * которые такой покупатель задаёт.
 *
 * Модель только предлагает: результат проверяется здесь (длина, повторы,
 * контрольные вопросы без брендов, доля вопросов с именем клиента), а
 * человек правит черновик до сохранения. Любой сбой — шаблоны, а не ошибка:
 * пустой экран на шаге онбординга хуже посредственных вопросов.
 */

const ENDPOINT = "https://api.openai.com/v1/responses";
const MAX_TEXT = 160;
/** Вопросов с именем клиента — не больше: иначе бренд назван самим вопросом. */
const MAX_BRANDED = 2;
const MIN_CONTROLS = 3;

const CLUSTERS = {
  learning: "Learning the category",
  comparison: "Comparison",
  purchase: "Purchase intent",
  control: "Control (untouched)",
} as const;

export interface AiPromptSeed extends PromptSeed {
  /** Сжатый текст главной страницы клиента: заголовки, описание, разделы. */
  siteSummary?: string | null;
}

export interface AiPromptGeneratorConfig {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const draftSchema = z.object({
  prompts: z.array(
    z.object({
      text: z.string(),
      intent: z.enum(["learning", "comparison", "purchase", "control"]),
    }),
  ),
});

/** JSON Schema для строгого структурированного ответа. */
const RESPONSE_FORMAT = {
  type: "json_schema",
  name: "buyer_questions",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["prompts"],
    properties: {
      prompts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["text", "intent"],
          properties: {
            text: { type: "string" },
            intent: { type: "string", enum: ["learning", "comparison", "purchase", "control"] },
          },
        },
      },
    },
  },
} as const;

export function buildInstructions(seed: AiPromptSeed, count: number): string {
  const brand = seed.brandNames[0] ?? seed.domain;
  const competitors = seed.competitorNames.length > 0 ? seed.competitorNames.join(", ") : "none given";
  return [
    `Write ${count} questions that real buyers type into AI assistants such as ChatGPT or Perplexity while shopping in this category.`,
    "",
    `Client brand: ${brand} (${seed.domain})`,
    `Category as the agency describes it: ${seed.industry || "not given; infer it from the site"}`,
    `Tracked competitors: ${competitors}`,
    seed.siteSummary ? `What the client's homepage says:\n${seed.siteSummary}` : "The homepage could not be read.",
    "",
    "Rules:",
    "- Every question must be one an assistant answers by naming specific brands, products or providers. Ask 'which…', 'best… for…', 'what are good options for…', not 'how do I…' or 'how often…'.",
    "- Cover every product line and every buyer type the client serves (both sides of a marketplace, personal and team use). At least a third of the questions carry a concrete constraint: budget, location, condition, skill level, size or use case.",
    "- Use the homepage only to learn which products and audiences exist. Ignore seasonal promotions, navigation labels and slogans, and never reuse homepage phrases.",
    `- Do not name ${brand}: we measure whether assistants bring it up on their own. At most ${MAX_BRANDED} questions may name it, only as ${brand} vs a tracked competitor.`,
    "- Name a competitor only as 'alternatives to <competitor>' or opposite the client. Never compare two competitors with each other: that answer leaves no room for the client. Only pair a competitor with a product it actually sells.",
    "- Mix: about 40% comparison or recommendation, 25% learning (which options suit which need), 20% purchase (best under a price, free plan or trial, is it worth the price, deals and sale season, where to buy), 15% control.",
    "- Control questions name no brand but still ask for recommendations, on a segment or use case next to the client's main focus that the agency is unlikely to write about. No cleaning, maintenance or how-to-use questions.",
    "- No phrase or audience qualifier in more than 3 questions; vary the openings.",
    "- Write the way people type: short, natural, English, under 120 characters, no numbering, no quotes.",
    "- Do not state facts about the brand or its products; ask, do not claim.",
  ].join("\n");
}

function mentionsAny(text: string, names: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return names.some((name) => name.trim().length > 1 && lower.includes(name.trim().toLowerCase()));
}

/** Доли намерений в наборе: срез идёт по ним, а не с хвоста черновика. */
const INTENT_SHARE = { comparison: 0.4, learning: 0.25, purchase: 0.2, other: 0.15 } as const;

/** Слова вопроса без служебных — для поиска почти-повторов. */
function contentWords(text: string): Set<string> {
  const stop = new Set(["the", "a", "an", "for", "of", "to", "in", "on", "and", "or", "is", "are", "what", "which", "best", "my", "i", "with", "vs", "do", "does", "how", "should", "can", "good"]);
  return new Set(text.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !stop.has(w)));
}

function nearDuplicate(a: Set<string>, b: Set<string>): boolean {
  const shared = [...a].filter((w) => b.has(w)).length;
  const union = new Set([...a, ...b]).size;
  return union > 0 && shared / union >= 0.7;
}

/**
 * Черновик модели → набор, который продукт готов мерить.
 *
 * Чистая функция: всё, что модель могла сделать не так, правится здесь, а
 * недостающее добирается из шаблонов, чтобы набор не оказался короче нужного.
 *
 * Проверка на десяти компаниях (06.10.2026) показала три перекоса: срез с
 * хвоста съедал покупательские вопросы (модель пишет их последними),
 * «Brooks vs Hoka» не оставляет клиенту места в ответе, а почти-повторы
 * удваивали вес одной темы. Всё три правятся здесь.
 */
export function finalizeAiDraft(
  draft: readonly { text: string; intent: "learning" | "comparison" | "purchase" | "control" }[],
  seed: PromptSeed,
  count: number,
): GeneratedPrompt[] {
  const target = clampPromptCount(count);
  const seen = new Set<string>();
  const words: Set<string>[] = [];
  const out: GeneratedPrompt[] = [];
  let branded = 0;

  const accept = (prompt: GeneratedPrompt): boolean => {
    const key = prompt.text.toLowerCase();
    const bag = contentWords(prompt.text);
    if (seen.has(key) || words.some((other) => nearDuplicate(bag, other))) return false;
    seen.add(key);
    words.push(bag);
    out.push(prompt);
    return true;
  };

  for (const item of draft) {
    const text = item.text.trim().replace(/\s+/g, " ").replace(/^["'“]|["'”]$/g, "");
    if (text.length < 8 || text.length > MAX_TEXT) continue;

    const namesBrand = mentionsAny(text, seed.brandNames);
    const namesCompetitor = mentionsAny(text, seed.competitorNames);
    // Два конкурента друг против друга: ответ о них двоих, клиенту там нет места.
    if (namesCompetitor && !namesBrand && !/alternative|instead of|similar to|like /i.test(text)) continue;
    if (namesBrand && branded >= MAX_BRANDED) continue;

    // Контрольный вопрос с брендом — уже не контроль: работа агентства его сдвинет.
    const control = item.intent === "control" && !namesBrand && !namesCompetitor;
    const intent = item.intent === "control" ? (control ? "other" : "learning") : item.intent;
    const accepted = accept({
      text,
      intent,
      cluster: control ? CLUSTERS.control : CLUSTERS[item.intent === "control" ? "learning" : item.intent],
      isControl: control,
    });
    if (accepted && namesBrand) branded++;
  }

  // Без контрольных вопросов эксперименты не с чем сравнивать (контракт C5).
  const templates = buildPromptCandidates(seed);
  for (const candidate of templates.filter((t) => t.isControl)) {
    if (out.filter((prompt) => prompt.isControl).length >= MIN_CONTROLS) break;
    accept(candidate);
  }
  for (const candidate of templates) {
    if (out.length >= target) break;
    accept(candidate);
  }

  // Лишние срезаются у того намерения, что дальше всех ушло за свою долю.
  while (out.length > target) {
    const over = (Object.keys(INTENT_SHARE) as (keyof typeof INTENT_SHARE)[])
      .map((intent) => ({
        intent,
        excess: out.filter((p) => p.intent === intent).length - INTENT_SHARE[intent] * target,
      }))
      .filter(({ intent }) => intent !== "other" || out.filter((p) => p.isControl).length > MIN_CONTROLS)
      .sort((x, y) => y.excess - x.excess)[0];
    const index = over ? out.map((p) => p.intent).lastIndexOf(over.intent) : -1;
    out.splice(index >= 0 ? index : out.length - 1, 1);
  }
  return out;
}

interface ResponsePayload {
  output?: { type?: string; content?: { type?: string; text?: string }[] }[];
  output_text?: string;
}

function outputText(payload: ResponsePayload): string {
  if (typeof payload.output_text === "string") return payload.output_text;
  return (payload.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text ?? "")
    .join("");
}

export class AiPromptGenerator implements PromptGenerator {
  constructor(private readonly config: AiPromptGeneratorConfig) {}

  async generate(seed: AiPromptSeed, count = DEFAULT_GENERATED_PROMPT_COUNT): Promise<GeneratedPrompt[]> {
    const target = clampPromptCount(count);
    const payload = await postJson<ResponsePayload>({
      provider: "OpenAI",
      url: ENDPOINT,
      headers: { Authorization: `Bearer ${this.config.apiKey}` },
      body: JSON.stringify({
        model: this.config.model,
        // Без веб-поиска: вопросы пишутся по сайту, а не по выдаче, и вызов
        // стоит доли цента.
        reasoning: { effort: "low" },
        input: buildInstructions(seed, target + 4),
        text: { format: RESPONSE_FORMAT },
        max_output_tokens: 4000,
      }),
      fetchImpl: this.config.fetchImpl ?? fetch,
      maxAttempts: 2,
      sleep: defaultSleep,
      timeoutMs: this.config.timeoutMs ?? 45_000,
    });

    const draft = draftSchema.parse(JSON.parse(outputText(payload)));
    return finalizeAiDraft(draft.prompts, seed, target);
  }
}
