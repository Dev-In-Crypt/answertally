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

/** Разбор одной строки CSV с поддержкой кавычек и запятых внутри значений. */
export function parseCsvLine(line: string): string[] {
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
    } else if (char === ",") {
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
  // BOM задаётся escape-последовательностью: буквальный символ невидим в коде.
  const text = input.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const lines = text.split("\n").filter((line) => line.trim() !== "");

  if (lines.length === 0) {
    return { rows: [], errors: ["The file is empty."] };
  }

  const header = parseCsvLine(lines[0] ?? "").map((h) => h.toLowerCase());
  const hasHeader = header.includes("prompt");

  if (!hasHeader) {
    return {
      rows: [],
      errors: ['Missing header row. Expected columns: cluster, intent, prompt, is_control.'],
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

  for (let i = 1; i < lines.length; i++) {
    const lineNumber = i + 1;
    const cells = parseCsvLine(lines[i] ?? "");

    const cluster = (cells[clusterIdx] ?? "").trim();
    const prompt = (cells[promptIdx] ?? "").trim();

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
    const key = `${cluster.toLowerCase()}|${prompt.toLowerCase()}`;
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
