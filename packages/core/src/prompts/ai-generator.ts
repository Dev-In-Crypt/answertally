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
    "- Use the product types, use cases and audiences this client actually serves, as the site shows them. A shoe brand gets questions about marathon training or trail running, not about teams or onboarding.",
    `- Do not name ${brand} in the questions: we measure whether assistants bring it up on their own. At most ${MAX_BRANDED} questions may name it, and only as a head-to-head comparison with a tracked competitor.`,
    "- Mix: about 40% comparison or recommendation (best, top, alternatives, vs), 25% learning (how to choose, what matters), 20% purchase (price, value, where to buy, reliability), 15% control.",
    "- Control questions are about the category in general and name no brand at all, neither the client nor a competitor.",
    "- Write the way people type: short, natural, English, under 120 characters, no numbering, no quotes.",
    "- Do not state facts about the brand or its products; ask, do not claim.",
  ].join("\n");
}

function mentionsAny(text: string, names: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return names.some((name) => name.trim().length > 1 && lower.includes(name.trim().toLowerCase()));
}

/**
 * Черновик модели → набор, который продукт готов мерить.
 *
 * Чистая функция: всё, что модель могла сделать не так, правится здесь, а
 * недостающее добирается из шаблонов, чтобы набор не оказался короче нужного.
 */
export function finalizeAiDraft(
  draft: readonly { text: string; intent: "learning" | "comparison" | "purchase" | "control" }[],
  seed: PromptSeed,
  count: number,
): GeneratedPrompt[] {
  const target = clampPromptCount(count);
  const seen = new Set<string>();
  const out: GeneratedPrompt[] = [];
  let branded = 0;

  for (const item of draft) {
    const text = item.text.trim().replace(/\s+/g, " ").replace(/^["'“]|["'”]$/g, "");
    const key = text.toLowerCase();
    if (text.length < 8 || text.length > MAX_TEXT || seen.has(key)) continue;

    const namesBrand = mentionsAny(text, seed.brandNames);
    const namesCompetitor = mentionsAny(text, seed.competitorNames);
    if (namesBrand) {
      if (branded >= MAX_BRANDED) continue;
      branded++;
    }

    // Контрольный вопрос с брендом — уже не контроль: работа агентства его сдвинет.
    const control = item.intent === "control" && !namesBrand && !namesCompetitor;
    const intent = item.intent === "control" ? (control ? "other" : "learning") : item.intent;
    seen.add(key);
    out.push({
      text,
      intent,
      cluster: control ? CLUSTERS.control : CLUSTERS[item.intent === "control" ? "learning" : item.intent],
      isControl: control,
    });
  }

  // Без контрольных вопросов эксперименты не с чем сравнивать (контракт C5).
  const templates = buildPromptCandidates(seed);
  let controls = out.filter((prompt) => prompt.isControl).length;
  for (const candidate of templates.filter((t) => t.isControl)) {
    if (controls >= MIN_CONTROLS) break;
    if (seen.has(candidate.text.toLowerCase())) continue;
    seen.add(candidate.text.toLowerCase());
    out.push(candidate);
    controls++;
  }
  for (const candidate of templates) {
    if (out.length >= target) break;
    if (seen.has(candidate.text.toLowerCase())) continue;
    seen.add(candidate.text.toLowerCase());
    out.push(candidate);
  }

  // Лишние срезаются с конца, но контрольные остаются.
  while (out.length > target) {
    const lastRegular = out.map((p) => p.isControl).lastIndexOf(false);
    out.splice(lastRegular >= 0 ? lastRegular : out.length - 1, 1);
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
