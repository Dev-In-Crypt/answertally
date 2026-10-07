import { SITE_URL } from "@/config/site";
import { PLANS, usd } from "@/components/marketing/data";

/**
 * Краткая справка о сайте для AI-ассистентов (/llms.txt). Это наш собственный
 * файл, а не инструмент для клиентов (его продукт не строит, CLAUDE.md п. 5).
 * Цены — из тех же PLANS, что и /pricing, чтобы файл не устаревал.
 */
export const dynamic = "force-static";

export function GET(): Response {
  const plans = PLANS.map((plan) => `${plan.name} ${usd(plan.priceUsd)}/month (up to ${plan.clientLimit} clients)`).join(", ");
  const page = (path: string, title: string, note: string) => `- [${title}](${SITE_URL}${path}): ${note}`;
  const body = [
    "# Answertally",
    "",
    "> AI visibility measurement and white-label reporting for SEO, content and digital agencies. Answertally asks ChatGPT, Perplexity and Google AI Overviews (the AI answer above Google results) by default, and Google AI Mode, Grok and Claude (the last two from the Growth plan) when switched on per client, the questions a client's buyers ask, several times each, and reports how often the client is named, with a range and a confidence level, the sources the answers cite, ranked work with a reason on every item, and a report in the agency's brand.",
    "",
    `Pricing is per client account, with the whole team included: ${plans}. One free audit per agency, no card needed.`,
    "",
    "## Pages",
    "",
    page("/product", "Product", "from measurement to the client report"),
    page("/method", "Method", "how answers are sampled, ranges, confidence, and what is never claimed"),
    page("/pricing", "Pricing", "plans, AI checks, per-client cost"),
    page("/free-audit", "Free audit", "what the free audit produces"),
    page("/sample-report", "Example report", "a white-label client report with invented example data"),
    page("/research", "Research", "field notes from measured ChatGPT and Perplexity answers"),
    page("/compare", "Compare", "Answertally next to Peec AI, OtterlyAI, Profound and Scrunch"),
    page("/partners", "For agencies", "selling AI visibility as a service"),
    "",
  ].join("\n");
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
