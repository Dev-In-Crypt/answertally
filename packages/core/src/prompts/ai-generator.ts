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
    "- Center on what the homepage shows as the client's main products. If its flagship differs from the agency's category, center on the flagship. Cover each product line the homepage names, and the other side of a marketplace if it has one.",
    "- At least 8 questions turn something distinctive about the client (a feature, format or approach the homepage shows) into a buyer need, in the buyer's words, without naming the client. At most 5 questions are broad 'best <category> for <use>' questions: a small brand never shows up in those.",
    "- Add a secondary audience (teams, wholesale, agencies, pros, public sector) only if the homepage names it, and in at most 2 questions. Never invent buyers.",
    "- One concrete constraint per question at most (budget, size, skill level, use case), and only one a real buyer would mention. Price caps must fit the client's price tier: for a premium brand ask about quality or gifts, not bargains.",
    "- Buyers are in the United States: prices in US dollars, US places and seasons. The homepage may be a regional version for another country; ignore its currency, language and locations.",
    "- Use the homepage only to learn which products and audiences exist. Ignore seasonal promotions, navigation labels and slogans, and never reuse homepage phrases.",
    `- Do not name ${brand}: we measure whether assistants bring it up on their own. At most ${MAX_BRANDED} questions may name it, only as ${brand} vs a tracked competitor.`,
    "- Name a competitor only as 'alternatives to <competitor>' (at most 2 per competitor) or opposite the client. Never compare two competitors with each other: that answer leaves no room for the client. Pair a competitor only with its best-known product line, where it overlaps the client's.",
    "- Mix: about 40% comparison or recommendation, 25% learning (which options suit which need), 20% purchase (best under a price, free plan or trial, is it worth the price, deals and sale season, where to buy), 15% control.",
    "- Control questions ask for recommendations in a neighbouring category the client does not sell (for an olive oil brand: avocado oil, cast-iron pans), name no brand, and never use the client's category words. No cleaning, maintenance or how-to-use questions.",
    "- No phrase or audience qualifier in more than 3 questions; vary the openings. At most 1 'is it worth it' question. Say 'US' only where location changes the answer. 'Where to buy' only for physical goods; for software ask about free plans, trials or pricing.",
    "- Write the way people type: short, natural, English, under 120 characters, no numbering, no quotes.",
    "- Do not state facts about the brand or its products; ask, do not claim.",
  ].join("\n");
}

function mentionsAny(text: string, names: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return names.some((name) => name.trim().length > 1 && lower.includes(name.trim().toLowerCase()));
}

/**
 * Вопросы, на которые ассистент отвечает без брендов: «что смотреть»,
 * «какие бывают виды», «когда скидки». Инструкция их запрещает, но модель
 * пишет их всё равно (до 6 в наборе на проверке 06.10.2026) — они добавляют
 * в долю нули и размывают движение.
 */
const NO_BRAND_ANSWER =
  /^(what should (i|you|we) look for|what (are the )?differences? between|what kinds? of|which (types?|kinds?) of|when do .*(sale|discount)|how (do|often|long|should))/i;

/** Слова категории из поля агентства: контрольный вопрос с ними уже не контроль. */
const GENERIC_CATEGORY_WORDS = new Set(["software", "service", "services", "product", "products", "online", "tools", "tool", "best", "apps", "app", "platform", "company", "companies", "for", "and", "hire"]);

function categoryWords(industry: string): string[] {
  return industry
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length > 3 && !GENERIC_CATEGORY_WORDS.has(word))
    .map((word) => word.replace(/s$/, ""));
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
  const category = categoryWords(seed.industry);
  const perCompetitor = new Map<string, number>();

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
    if (item.intent !== "control" && !namesBrand && !namesCompetitor && NO_BRAND_ANSWER.test(text)) continue;
    const competitor = seed.competitorNames.find((name) => mentionsAny(text, [name]));
    if (competitor && !namesBrand) {
      const used = perCompetitor.get(competitor) ?? 0;
      if (used >= 2) continue;
      perCompetitor.set(competitor, used + 1);
    }

    // Контрольный вопрос с брендом — уже не контроль: работа агентства его сдвинет.
    // Контроль в нише клиента сдвинется вместе с работой агентства — это уже не контроль.
    const inCategory = category.some((word) => text.toLowerCase().includes(word));
    const control = item.intent === "control" && !namesBrand && !namesCompetitor && !inCategory;
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
      // При равенстве первым режется лишний контроль: иначе вылетало сравнение (9/6/5/4).
      .sort((x, y) => y.excess - x.excess || (x.intent === "other" ? -1 : y.intent === "other" ? 1 : 0))[0];
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
