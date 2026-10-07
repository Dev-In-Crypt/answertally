import type { Metadata } from "next";
import Link from "next/link";
import { CtaNote, SecHead } from "@/components/marketing/bits";
import { MarketingShell } from "@/components/marketing/chrome";

/**
 * Сравнение с другими инструментами видимости в ИИ.
 *
 * Только то, что видно на сайтах самих конкурентов, с датой проверки и
 * ссылкой на источник. Неподтверждённое не пишется вовсе (цены Peec грузятся
 * скриптом — их нет). Где конкуренты сильнее, сказано прямо: таблица, которая
 * выигрывает по всем строкам, не убеждает агентство, которое проверит сам.
 * Перепроверять раз в квартал: тарифы у всех меняются.
 */

export const metadata: Metadata = {
  alternates: { canonical: "/compare" },
  title: "Answertally vs Peec AI, Otterly, Profound and Scrunch",
  description:
    "How Answertally compares with Peec AI, OtterlyAI, Profound and Scrunch on pricing, the headline metric, ranges, white-label reports and engines. Checked on each vendor’s site.",
};

const CHECKED = "7 October 2026";

type Cell = { text: string; href?: string };
const VENDORS = ["Answertally", "Peec AI", "OtterlyAI", "Profound", "Scrunch"] as const;

const ROWS: { label: string; cells: Cell[] }[] = [
  {
    label: "Priced by",
    cells: [
      { text: "Client account" },
      { text: "Prompt volume and projects", href: "https://peec.ai/pricing" },
      { text: "Prompt volume", href: "https://otterly.ai/pricing" },
      { text: "Client workspace (agency plan, $399 each, 100 prompts)", href: "https://tryprofound.com/blog/agencies-launch-your-aeo-practice-with-profound" },
      { text: "Prompts and responses ($250 Core: 125 prompts, 1 brand)", href: "https://scrunch.com/pricing" },
    ],
  },
  {
    label: "Team seats",
    cells: [
      { text: "Unlimited" },
      { text: "Unlimited", href: "https://peec.ai/pricing" },
      { text: "Unlimited", href: "https://otterly.ai/pricing" },
      { text: "5 on the agency plan", href: "https://tryprofound.com/blog/agencies-launch-your-aeo-practice-with-profound" },
      { text: "5 on Core", href: "https://scrunch.com/pricing" },
    ],
  },
  {
    label: "Headline metric",
    cells: [
      { text: "Share of answers naming the client, with its range and a confidence level. No score, no rank." },
      { text: "Visibility Score, Position", href: "https://docs.peec.ai/metrics/brand-metrics/visibility" },
      { text: "Brand Visibility Index, Domain Ranking", href: "https://help.otterly.ai/brand-report-kpi-definition" },
      { text: "Visibility Score, Share of Voice, Average Position", href: "https://www.tryprofound.com/" },
      { text: "Mentions rate, Position Average (0–100)", href: "https://helpcenter.scrunchai.com/en/articles/13722130-data-studio-metrics-and-chart-definitions" },
    ],
  },
  {
    label: "Range shown on every figure",
    cells: [
      { text: "Yes: 95% interval and the number of answers behind it" },
      { text: "Not found in their docs" },
      { text: "Not found in their docs" },
      { text: "Not found in their docs" },
      { text: "Not found; their docs call the data “directional”", href: "https://helpcenter.scrunchai.com/en/articles/13722130-data-studio-metrics-and-chart-definitions" },
    ],
  },
  {
    label: "Client report in your brand",
    cells: [
      { text: "Every plan: a link and a PDF, approved by the client" },
      { text: "Through Looker Studio", href: "https://peec.ai/pricing-agencies" },
      { text: "No native white-label (their help center)", href: "https://help.otterly.ai/white-label" },
      { text: "Not mentioned", href: "https://help.tryprofound.com/articles/8593548222-agency-mode-overview" },
      { text: "Through their API", href: "https://scrunch.com/agencies" },
    ],
  },
  {
    label: "Assistants",
    cells: [
      { text: "ChatGPT and Perplexity; Grok, Claude, Google AI Overviews and AI Mode switched on per client" },
      { text: "Pick 3, incl. ChatGPT, Google AI Mode and AI Overviews, Copilot, Gemini", href: "https://peec.ai/pricing" },
      { text: "ChatGPT, Google AI Overviews, Perplexity, Copilot; more as add-ons", href: "https://otterly.ai/pricing" },
      { text: "Enterprise: ChatGPT, Perplexity, Google AI Mode, Gemini, Copilot, Claude and more", href: "https://www.tryprofound.com/pricing" },
      { text: "Core: ChatGPT, Perplexity, Google AI Overviews, Copilot", href: "https://scrunch.com/pricing" },
    ],
  },
  {
    label: "How to start",
    cells: [
      { text: "Free audit of one client, no card" },
      { text: "Trial, no card", href: "https://peec.ai/comparison/peec-vs-profound" },
      { text: "Free trial", href: "https://otterly.ai/pricing" },
      { text: "Trial: 50 prompts, 7 days", href: "https://www.tryprofound.com/pricing" },
      { text: "7-day trial, no card", href: "https://scrunch.com/pricing" },
    ],
  },
];

export default function ComparePage() {
  return (
    <MarketingShell>
      <div className="wrap">
        <section className="p-hero">
          <div>
            <div className="kicker page-kicker">Compare</div>
            <h1 className="display">
              The others sell a score. <em>We show the answers behind it.</em>
            </h1>
            <p className="lead">
              Peec AI, OtterlyAI, Profound and Scrunch are good tools, and they lead with a single
              visibility figure or a position. Answertally is built for the agency handing the
              number to a client: every share comes with its range, the answers behind it, and a
              report in the agency’s brand. Checked on each vendor’s own site on {CHECKED}.
            </p>
            <div className="ctas" style={{ marginTop: 28 }}>
              <Link className="btn primary" href="/signup">
                Audit your first client free
              </Link>
              <Link className="link" href="/sample-report">
                See an example report →
              </Link>
            </div>
            <CtaNote />
          </div>
        </section>
      </div>

      <section className="sec" id="table">
        <div className="wrap">
          <SecHead n={1} title="Side by side">
            Each cell links to the page it comes from. Prices and plans change; if one is out of date,
            write to us and we correct it.
          </SecHead>
          <p className="cmp-hint small muted">Swipe the table sideways to see every tool →</p>
          <div className="cmp-wrap">
            <table className="cmp vs" data-testid="compare-table">
              <thead>
                <tr>
                  <th scope="col" />
                  {VENDORS.map((vendor) => (
                    <th scope="col" key={vendor}>
                      {vendor}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    {row.cells.map((cell, i) => (
                      <td key={VENDORS[i]}>
                        {cell.href ? (
                          <a href={cell.href} rel="noopener noreferrer nofollow" target="_blank">
                            {cell.text}
                          </a>
                        ) : (
                          cell.text
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          <SecHead n={2} title="Where they are ahead, and where we are">
            Pick on what your clients will ask you, not on the longest feature list.
          </SecHead>
          <div className="g2">
            <div className="limit">
              <h3>Pick them if</h3>
              <p>
                You need Microsoft Copilot or Gemini today, daily tracking of hundreds of prompts for
                one brand, or an entry price under $100 for a single project.
              </p>
            </div>
            <div className="limit">
              <h3>Pick Answertally if</h3>
              <p>
                You run AI visibility as a service for many clients: priced per client with the whole
                team included, every figure with a range your client can check, ranked work with a
                reason on each item, and a report under your brand that the client approves by link.
              </p>
            </div>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
