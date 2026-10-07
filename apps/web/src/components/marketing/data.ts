import {
  checkUnits,
  ASSISTANTS,
  BASELINE_WINDOW_DAYS,
  CHECKS_PER_CLIENT_MONTH,
  DEFAULT_PLATFORMS,
  PLAN_LIMITS,
  confidenceFor,
  wilsonInterval,
  type ConfidenceLevel,
} from "@repo/core";
import { allowedAssistantLabels } from "@repo/core/adapters/capacity";

/**
 * Данные для графиков и карточек витрины.
 *
 * Всё выдумано и так и подписано на страницах («example data»): агентства,
 * клиент, конкуренты, домены в зоне `.example`. Концы рядов при этом совпадают
 * с собранным примером отчёта (`SAMPLE_HIGHLIGHTS`): кнопка «Open the full
 * example» ведёт на него, и цифры на витрине не должны с ним спорить. Имена
 * конкурентов — те же, что в примере отчёта.
 */

export const CLIENT = "Fernpost";

/** Цвета графиков. В SVG-атрибутах var() не работает, поэтому здесь hex — те же значения, что в токенах. */
export const C = {
  client: "#00A63E",
  clientInk: "#008236",
  comp: "#F54900",
  compInk: "#CA3500",
  grid: "#EEECE6",
  base: "#CFCCC2",
  muted: "#5E6572",
  ink2: "#3C414B",
  ink: "#15171C",
} as const;

export type SeriesKind = "client" | "comp" | "control";

export interface Series {
  name: string;
  data: number[];
  kind: SeriesKind;
  opacity?: number;
  strokeWidth?: number;
  markers?: boolean;
}

/* ---------------- карточка «как агентство видит цифру» ---------------- */

/**
 * Пример экрана агентства: доля клиента за окно по умолчанию (28 дней) при
 * каденсе по умолчанию (раз в две недели) — два прогона по 24 вопроса,
 * 3 ассистента, 3 сэмпла. Интервал и уверенность считаются теми же функциями,
 * что в продукте, а не вписаны руками.
 */
export const EVIDENCE_WINDOW_DAYS = 28;
export const EVIDENCE_PROMPTS = 24;
const RUNS_IN_WINDOW = 2;
const SAMPLES = 3;
const PER_ASSISTANT = EVIDENCE_PROMPTS * SAMPLES * RUNS_IN_WINDOW;

export interface EvidenceRow {
  assistant: string;
  named: number;
  answers: number;
  pct: number;
  low: number;
  high: number;
  confidence: ConfidenceLevel;
}

function evidenceRow(assistant: string, named: number, answers: number): EvidenceRow {
  const interval = wilsonInterval(named, answers);
  return {
    assistant,
    named,
    answers,
    pct: interval?.pct ?? 0,
    low: Math.round(interval?.low ?? 0),
    high: Math.round(interval?.high ?? 0),
    confidence: confidenceFor(answers),
  };
}

/**
 * По ассистентам. Общая доля — сумма названий на все ответы окна, около 29%:
 * рядом с концом квартала в примере отчёта, но окно другое (28 дней, а не
 * неделя), поэтому до десятых они не обязаны совпадать.
 */
export const EVIDENCE_ROWS: EvidenceRow[] = [
  evidenceRow("ChatGPT", 48, PER_ASSISTANT),
  evidenceRow("Perplexity", 37, PER_ASSISTANT),
  evidenceRow("Grok", 39, PER_ASSISTANT),
];

export const EVIDENCE_TOTAL = evidenceRow(
  "All three",
  EVIDENCE_ROWS.reduce((sum, row) => sum + row.named, 0),
  EVIDENCE_ROWS.reduce((sum, row) => sum + row.answers, 0),
);

/* ---------------- эксперимент ---------------- */

/**
 * Пример эксперимента: темы, которые покрыла работа, против нетронутых тем за
 * те же недели (контракт C5: Δtreatment − Δcontrol). Иллюстрация метода, а не
 * данные из примера отчёта: в квартале примера нетронутых тем не было, и отчёт
 * так и говорит. Поэтому пример лежит в следующем спринте.
 *
 * Окна — как в продукте: «до» — 28 дней перед отметкой «done» (четыре недели),
 * «после» — все недели начиная с неё. Недели на переобход не пропускаются:
 * такого правила в расчёте нет.
 */
export const EXPERIMENT = {
  weeks: ["W22", "W23", "W24", "W25", "W26", "W27", "W28", "W29", "W30", "W31", "W32", "W33"],
  actionWeekIndex: 5,
  treated: [18.8, 19.2, 18.7, 19.1, 19.0, 20.6, 22.1, 23.4, 24.2, 24.9, 25.3, 25.5],
  untouched: [19.6, 20.1, 19.7, 19.9, 19.8, 20.4, 20.9, 21.3, 21.6, 21.9, 22.0, 22.2],
  /** До: W23–W26 (четыре недельных среза = BASELINE_WINDOW_DAYS); после: W27–W33. */
  before: [1, 5] as const,
  after: [5, 12] as const,
  baselineDays: BASELINE_WINDOW_DAYS,
};

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function periodMean(series: number[], [from, to]: readonly [number, number]): number {
  return Math.round(mean(series.slice(from, to)) * 10) / 10;
}

/* ---------------- промпт × ассистент ---------------- */

/**
 * Колонки таблицы на витрине — из каталога, а не списком имён.
 *
 * Список имён здесь уже один раз пережил и появление ассистентов, и уход
 * Gemini: витрина обещала то, чего продукт не делает.
 */
export const MATRIX_ASSISTANTS: readonly string[] = ASSISTANTS.filter((a) => a.measurable).map(
  (a) => a.label,
);

/** Ассистенты, которых по умолчанию не спрашивают: в таблице помечены «switched on». */
export const MATRIX_OPTIONAL: readonly string[] = ASSISTANTS.filter(
  (a) => a.measurable && !(DEFAULT_PLATFORMS as readonly string[]).includes(a.id),
).map((a) => a.label);

/** Число — доля ответов; "floor" — ниже порога сэмплов; null — ассистента не спрашивают. */
export type MatrixCell = number | "floor" | null;

/**
 * Ответов за ячейку в примере: 28 дней при замере раз в неделю — четыре
 * прогона по три ответа. Доли ниже кратны 1/12, уровень уверенности на
 * витрине считается из этого числа той же функцией, что в продукте.
 */
export const MATRIX_SAMPLES = 12;

export const MATRIX: { prompt: string; cells: MatrixCell[]; competitorOnly?: boolean[] }[] = [
  { prompt: "best project tool for a small design studio", cells: [42, 33, 25, 33] },
  { prompt: "Fernpost vs Quillstack", cells: [92, 100, 75, 92] },
  { prompt: "project software with a client portal", cells: [25, 8, 33, 8] },
  {
    prompt: "cheapest way to share timelines with clients",
    cells: [0, 0, 8, "floor"],
    competitorOnly: [true, true, false, false],
  },
  {
    prompt: "how to move a studio off spreadsheets",
    cells: [8, 0, 0, 25],
    competitorOnly: [false, true, false, false],
  },
  { prompt: "project tool with time tracking and invoicing", cells: [33, 25, 42, 25] },
];

/* ---------------- источники ---------------- */

/** Доля ответов, цитирующих источник, в примере. «gap» — конкурент назван, клиент нет. */
export const SOURCES = [
  { domain: "reviewhub.example", kind: "gap", note: "gap", pct: 18 },
  { domain: "forum.example", kind: "gap", note: "gap", pct: 12 },
  { domain: "toolreview.example", kind: "has", note: "names both", pct: 9 },
  { domain: "listings.example", kind: "gap", note: "gap", pct: 7 },
  { domain: "fernpost.example", kind: "has", note: "names client", pct: 6 },
] as const;

/* ---------------- агентства для белой карточки ---------------- */

export interface ExampleAgency {
  name: string;
  mark: string;
  color: string;
}

/** Выдуманные агентства. Цвета нарочно не индиго: на карточке нет ничего нашего. */
export const AGENCIES: ExampleAgency[] = [
  { name: "Northwind Studio", mark: "N", color: "#1F3A5F" },
  { name: "Harbor & Pine", mark: "H", color: "#8B2F4E" },
];

/* ---------------- тарифы ---------------- */

export type PlanId = "starter" | "growth" | "scale";

/**
 * Типичный расход клиента, округлённый до 50 — так его и называют в тексте.
 * `CHECKS_PER_CLIENT_MONTH` посчитан для еженедельного опроса: по нему
 * выставлены allowance, и это худший обычный случай. По умолчанию продукт
 * опрашивает раз в две недели — это вдвое меньше.
 */
export const TYPICAL_CHECKS_PER_CLIENT = Math.round(CHECKS_PER_CLIENT_MONTH / 50) * 50;
export const TYPICAL_CHECKS_BIWEEKLY = Math.round(CHECKS_PER_CLIENT_MONTH / 2 / 50) * 50;

/**
 * Сколько проверок съедает клиент, которому включили всё, что даёт тариф.
 *
 * Считается из каталога и умолчания, а не «пять вместо трёх» числом в тексте:
 * состав меняется решениями по тарифам и по тому, кого мы вообще измеряем, и
 * вписанное число разъезжается с ними молча. Так уже было — фраза про пять
 * ассистентов пережила и появление Grok в умолчании, и уход Gemini.
 */
export const MEASURABLE_ASSISTANT_COUNT = ASSISTANTS.filter((a) => a.measurable).length;
const MEASURABLE_IDS = ASSISTANTS.filter((a) => a.measurable).map((a) => a.id);

export const TYPICAL_CHECKS_ALL_ASSISTANTS =
  Math.round(
    (TYPICAL_CHECKS_PER_CLIENT * checkUnits(MEASURABLE_IDS)) / checkUnits(DEFAULT_PLATFORMS) / 50,
  ) * 50;

export const PLANS: {
  id: PlanId;
  name: string;
  audience: string;
  priceUsd: number;
  clientLimit: number;
  aiCheckAllowance: number;
  checksPerClient: number;
  perClientUsd: number;
  typicalUse: number;
  assistants: string;
}[] = (["starter", "growth", "scale"] as const).map((id) => {
  const limits = PLAN_LIMITS[id];
  return {
    id,
    name: { starter: "Starter", growth: "Growth", scale: "Scale" }[id],
    audience: {
      starter: "A pilot on a few existing clients, or your first AI-visibility retainer",
      growth: "An AI-visibility line running across a book of clients",
      scale: "AI visibility as a standing service across the agency",
    }[id],
    priceUsd: limits.priceUsd,
    clientLimit: limits.clientLimit,
    aiCheckAllowance: limits.aiCheckAllowance,
    checksPerClient: Math.round(limits.aiCheckAllowance / limits.clientLimit / 10) * 10,
    // Цена за клиента при полном плане — считается, а не вписывается.
    perClientUsd: Math.round(limits.priceUsd / limits.clientLimit),
    typicalUse: limits.clientLimit * TYPICAL_CHECKS_PER_CLIENT,
    assistants: allowedAssistantLabels(id).join(", "),
  };
});

const perClient = PLANS.map((plan) => plan.perClientUsd);
export const PER_CLIENT_MIN = Math.min(...perClient);
export const PER_CLIENT_MAX = Math.max(...perClient);

/* ---------------- форматирование ---------------- */

export const usd = (value: number): string => `$${value.toLocaleString("en-US")}`;
export const int = (value: number): string => value.toLocaleString("en-US");

/** Пункты со знаком и типографским минусом: «+9.2», «−13.4». */
export function signed(value: number): string {
  if (value > 0) return `+${value}`;
  if (value < 0) return `−${Math.abs(value)}`;
  return "0";
}
