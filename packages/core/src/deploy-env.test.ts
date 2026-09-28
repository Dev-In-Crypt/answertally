import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Боевой шаблон окружения против боевого compose-файла.
 *
 * Это третий случай одной и той же поломки: значение живёт в двух местах и
 * однажды расходится молча. Здесь оно разошлось дважды сразу — GEMINI_API_KEY
 * пережил удаление ассистента, а ANTHROPIC_API_KEY и XAI_API_KEY в шаблон не
 * попали вовсе. То есть Claude и Grok на боевой машине включить было нечем,
 * и узнал бы об этом тот, кто в бою полез искать, почему их нет.
 *
 * Шаблон — единственная инструкция, по которой заполняют .env.production.
 * Чего в нём нет, того не задаст никто.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const compose = readFileSync(join(REPO_ROOT, "docker-compose.prod.yml"), "utf8");
const template = readFileSync(join(REPO_ROOT, ".env.production.example"), "utf8");

/** Имена из подстановок `${VAR}`, `${VAR:-x}`, `${VAR:?msg}`. */
const composeVars = new Set(
  [...compose.matchAll(/\$\{([A-Z0-9_]+)[:?}-]/g)].map((m) => m[1]!),
);

/** Имена, которым шаблон присваивает значение: строки вида `VAR=`. */
const templateVars = new Set(
  [...template.matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]!),
);

describe("боевой шаблон окружения", () => {
  it("предлагает все ключи платформ, которые читает compose", () => {
    /**
     * Только ключи, а не все переменные: у моделей, эндпоинтов и потолков
     * памяти есть рабочие умолчания в коде, и тянуть их в шаблон значит
     * предлагать менять то, что менять не нужно. Ключ умолчания не имеет:
     * без него ассистент просто не измеряется.
     */
    const keysInCompose = [...composeVars].filter((name) => name.endsWith("_API_KEY")).sort();
    const missing = keysInCompose.filter((name) => !templateVars.has(name));

    expect(missing).toEqual([]);
    // Страховка от того, что регулярное выражение однажды перестанет находить
    // что-либо вовсе и тест станет зелёным, ничего не проверяя.
    expect(keysInCompose.length).toBeGreaterThanOrEqual(4);
  });

  it("не предлагает заполнять то, чего compose не читает", () => {
    /**
     * Ровно та строка, на которой это поймано: GEMINI_API_KEY остался в
     * шаблоне после того, как ассистента убрали. Заполнивший его получил бы
     * ключ, не подключённый никуда, и решил бы, что измерение настроено.
     */
    const dead = [...templateVars].filter((name) => !composeVars.has(name)).sort();

    expect(dead).toEqual([]);
  });
});
