import { z } from "zod";
import {
  AiPromptGenerator,
  DEFAULT_GENERATED_PROMPT_COUNT,
  DEFAULT_OPENAI_MODEL,
  parseAdaptersMode,
  TemplatePromptGenerator,
} from "@repo/core";
import { errorReporter } from "@/server/observability";
import { hit } from "@/server/rate-limit";
import { fetchSiteSummary } from "@/server/site-summary";
import { verifyCaptcha } from "@/server/captcha";

/**
 * Предпросмотр вопросов без регистрации: сайт клиента → черновик вопросов,
 * которые стоит отслеживать. Ответы ассистентов здесь не запрашиваются —
 * это только генерация (доля цента), замер начинается после регистрации.
 *
 * Адрес открыт без входа, поэтому два потолка: на IP и общий в сутки.
 * Сверх общего потолка — шаблоны: бесплатно и без отказа посетителю.
 */
export const dynamic = "force-dynamic";

const PER_IP_PER_DAY = 3;
const AI_PREVIEWS_PER_DAY = 150;

const input = z.object({
  domain: z.string().trim().min(3).max(200),
  name: z.string().trim().min(1).max(100),
  industry: z.string().trim().min(2).max(120),
  competitors: z.array(z.string().trim().min(1).max(80)).max(5).default([]),
});

const templates = new TemplatePromptGenerator();

export async function POST(request: Request): Promise<Response> {
  // Caddy ставит адрес клиента в X-Forwarded-For; чужим значениям не доверяет.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!(await hit(`preview:${ip}`, PER_IP_PER_DAY, 86_400))) {
    return Response.json({ error: "limit" }, { status: 429 });
  }

  if (!(await verifyCaptcha(request.headers.get("x-captcha-response"), ip))) {
    return Response.json({ error: "captcha" }, { status: 403 });
  }

  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });

  const seed = {
    domain: parsed.data.domain,
    industry: parsed.data.industry,
    brandNames: [parsed.data.name],
    competitorNames: parsed.data.competitors,
  };

  const apiKey = process.env.OPENAI_API_KEY;
  const live = parseAdaptersMode(process.env.ADAPTERS_MODE) === "live" && apiKey;
  if (live && (await hit("preview:all", AI_PREVIEWS_PER_DAY, 86_400))) {
    try {
      const siteSummary = await fetchSiteSummary(seed.domain);
      const generator = new AiPromptGenerator({ apiKey, model: process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL });
      const prompts = await generator.generate({ ...seed, siteSummary }, DEFAULT_GENERATED_PROMPT_COUNT);
      return Response.json({ prompts: prompts.map(({ text, intent, isControl }) => ({ text, intent, isControl })), siteRead: siteSummary !== null });
    } catch (error) {
      errorReporter.captureError(error, { scope: "preview_questions" });
    }
  }

  const prompts = await templates.generate(seed, DEFAULT_GENERATED_PROMPT_COUNT);
  return Response.json({ prompts: prompts.map(({ text, intent, isControl }) => ({ text, intent, isControl })), siteRead: false });
}
