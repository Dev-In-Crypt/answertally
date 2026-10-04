import { CLUSTER_NAME_MAX, PROMPT_TEXT_MAX } from "../config/measurement";

/**
 * Импорт промптов из CSV. Колонки: cluster, intent, prompt, is_control.
 *
 * Свой парсер, а не библиотека: формат фиксирован и узок, а зависимость ради
 * тридцати строк добавляет поверхность для проблем со сборкой.
 */

export type PromptIntent = "learning" | "comparison" | "purchase" | "other";

const INTENTS: readonly PromptIntent[] = ["learning", "comparison", "purchase", "other"];

export interface ImportedPromptRow {
  cluster: string;
  intent: PromptIntent;
  prompt: string;
  isControl: boolean;
}

export interface CsvImportResult {
  rows: ImportedPromptRow[];
  /** Человекочитаемые проблемы с номерами строк — их показывают агентству. */
  errors: string[];
}

/**
 * Байты файла → текст.
 *
 * Excel на Windows сохраняет «CSV (разделители — запятые)» в ANSI, а не в
 * UTF-8: `file.text()` превращал «What’s» в «What�s», и испорченный вопрос
 * уходил ассистентам и в отчёты. Невалидный UTF-8 — признак ANSI; какая
 * именно кодовая страница, угадываем по кириллице: в cp1251 буквы идут
 * подряд старшими байтами, в cp1252 старшие байты одиночны (’, é, ü).
 */
export function decodeCsvBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    let high = 0;
    let paired = 0;
    for (let i = 0; i < bytes.length; i++) {
      if ((bytes[i] ?? 0) < 0x80) continue;
      high++;
      if ((bytes[i - 1] ?? 0) >= 0x80 || (bytes[i + 1] ?? 0) >= 0x80) paired++;
    }
    return new TextDecoder(paired * 2 > high ? "windows-1251" : "windows-1252").decode(bytes);
  }
}

/** Как выглядит первая строка — чтобы отказ показывал, что именно мы прочитали. */
export function firstRowPreview(cells: string[]): string {
  const joined = cells.join(", ");
  return joined.length > 80 ? `${joined.slice(0, 80)}…` : joined;
}

export interface CsvRecord {
  /** Номер строки таблицы, как его покажет Excel: пустые строки считаются. */
  line: number;
  cells: string[];
}

/**
 * Разбор файла на записи.
 *
 * Записи режутся по переводам строк вне кавычек: Excel пишет ячейку с
 * Alt+Enter в кавычках на нескольких строках, и разбивка «по строкам, потом
 * по кавычкам» импортировала обрезанный вопрос. Разделитель берётся из
 * заголовка: европейский Excel пишет «;», потому что запятая там десятичная.
 * `skipComments` пропускает строки «#…» — ими GA4 начинает выгрузку.
 */
export function parseCsvRecords(
  input: string,
  options: { skipComments?: boolean } = {},
): CsvRecord[] {
  // BOM снимается проверкой кода, а не литералом: сам символ в исходнике невидим.
  const withoutBom = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const text = withoutBom.replace(/\r\n?/g, "\n");
  const raw: string[] = [];
  let current = "";
  let inQuotes = false;

  for (const char of text) {
    if (char === '"') inQuotes = !inQuotes;
    if (char === "\n" && !inQuotes) {
      raw.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  raw.push(current);

  const records = raw
    .map((record, index) => ({ line: index + 1, record }))
    .filter(({ record }) => record.trim() !== "")
    .filter(({ record }) => !(options.skipComments && record.trimStart().startsWith("#")));

  const header = records[0]?.record ?? "";
  const delimiter = header.split(";").length > header.split(",").length ? ";" : ",";
  return records.map(({ line, record }) => ({ line, cells: parseCsvLine(record, delimiter) }));
}

/** Разбор одной строки CSV с поддержкой кавычек и разделителей внутри значений. */
export function parseCsvLine(line: string, delimiter: "," | ";" = ","): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values.map((value) => value.trim());
}

function parseBoolean(raw: string): boolean {
  return ["1", "true", "yes", "y"].includes(raw.trim().toLowerCase());
}

function normalizeIntent(raw: string): PromptIntent {
  const value = raw.trim().toLowerCase();
  return (INTENTS as readonly string[]).includes(value) ? (value as PromptIntent) : "other";
}

/**
 * Разбирает CSV целиком. Не бросает исключений: частично валидный файл
 * должен импортироваться, а проблемные строки — быть названы по номерам,
 * иначе агентство с сотней промптов не поймёт, что именно чинить.
 */
export function parsePromptCsv(input: string): CsvImportResult {
  // BOM и переводы строк снимает разбор записей.
  const [first, ...records] = parseCsvRecords(input);

  if (!first) {
    return { rows: [], errors: ["The file is empty."] };
  }

  const header = first.cells.map((h) => h.toLowerCase());
  const hasHeader = header.includes("prompt");

  if (!hasHeader) {
    return {
      rows: [],
      errors: [
        `Missing header row. Expected columns: cluster, intent, prompt, is_control. The first row reads: ${firstRowPreview(first.cells)}`,
      ],
    };
  }

  const indexOf = (name: string): number => header.indexOf(name);
  const clusterIdx = indexOf("cluster");
  const intentIdx = indexOf("intent");
  const promptIdx = indexOf("prompt");
  const controlIdx = indexOf("is_control");

  if (clusterIdx === -1 || promptIdx === -1) {
    return { rows: [], errors: ['Columns "cluster" and "prompt" are required.'] };
  }

  const rows: ImportedPromptRow[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const { line: lineNumber, cells } of records) {
    // Перевод строки внутри ячейки — вёрстка таблицы, а не часть вопроса.
    const cluster = (cells[clusterIdx] ?? "").replace(/\s+/g, " ").trim();
    const prompt = (cells[promptIdx] ?? "").replace(/\s+/g, " ").trim();

    if (cluster === "" || prompt === "") {
      errors.push(`Line ${lineNumber}: cluster and prompt cannot be empty.`);
      continue;
    }

    // Те же границы, что у формы: без них через файл проходил вопрос на
    // полмегабайта, и каждый ответ на него стоил десятки центов.
    if (prompt.length > PROMPT_TEXT_MAX || cluster.length > CLUSTER_NAME_MAX) {
      errors.push(
        `Line ${lineNumber}: prompts are up to ${PROMPT_TEXT_MAX} characters and cluster names up to ${CLUSTER_NAME_MAX}, skipped.`,
      );
      continue;
    }

    // Дубли внутри файла молча схлопывать нельзя: агентство должно узнать,
    // что часть строк не импортировалась, иначе счёт промптов не сойдётся.
    // Один вопрос в двух кластерах — тоже дубль: спрашивается он одинаково.
    const key = normalizePromptText(prompt);
    if (seen.has(key)) {
      errors.push(`Line ${lineNumber}: duplicate prompt in this file, skipped.`);
      continue;
    }
    seen.add(key);

    rows.push({
      cluster,
      intent: intentIdx === -1 ? "other" : normalizeIntent(cells[intentIdx] ?? ""),
      prompt,
      isControl: controlIdx === -1 ? false : parseBoolean(cells[controlIdx] ?? ""),
    });
  }

  return { rows, errors };
}

/**
 * Ключ «тот же вопрос»: регистр и пробелы не меняют того, что спросят у
 * ассистента. По нему повторный импорт пропускает уже отслеживаемое.
 */
export function normalizePromptText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Группировка по кластерам — в таком виде импорт ложится в БД. */
export function groupByCluster(
  rows: ImportedPromptRow[],
): { cluster: string; intent: PromptIntent; prompts: { text: string; isControl: boolean }[] }[] {
  const groups = new Map<
    string,
    { cluster: string; intent: PromptIntent; prompts: { text: string; isControl: boolean }[] }
  >();

  for (const row of rows) {
    const key = row.cluster.toLowerCase();
    let group = groups.get(key);
    if (!group) {
      group = { cluster: row.cluster, intent: row.intent, prompts: [] };
      groups.set(key, group);
    }
    group.prompts.push({ text: row.prompt, isControl: row.isControl });
  }

  return [...groups.values()];
}
