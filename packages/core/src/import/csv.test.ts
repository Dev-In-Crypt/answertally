import { describe, expect, it } from "vitest";
import { groupByCluster, parseCsvLine, parsePromptCsv } from "./csv";

describe("parseCsvLine", () => {
  const cases: [string, string[]][] = [
    ["a,b,c", ["a", "b", "c"]],
    ["a, b , c", ["a", "b", "c"]],
    ['"a,b",c', ["a,b", "c"]],
    ['"say ""hi""",x', ['say "hi"', "x"]],
    ["a,,c", ["a", "", "c"]],
  ];

  it.each(cases)("%s", (line, expected) => {
    expect(parseCsvLine(line)).toEqual(expected);
  });
});

describe("parsePromptCsv", () => {
  const VALID = [
    "cluster,intent,prompt,is_control",
    "CRM comparison,comparison,best CRM for startups,false",
    "CRM comparison,comparison,HubSpot alternatives,false",
    "CRM basics,learning,what is a sales CRM,false",
    "CRM basics,learning,best project management tool,true",
  ].join("\n");

  it("слишком длинный вопрос пропускается с ошибкой, как в форме", () => {
    // Через файл проходил вопрос на полмегабайта — каждый ответ на него
    // стоил десятки центов.
    const csv = [VALID, `CRM basics,learning,${"x".repeat(1001)},false`].join("\n");
    const result = parsePromptCsv(csv);

    expect(result.rows).toHaveLength(4);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/1000 characters/);
  });

  it("разбирает валидный файл", () => {
    const result = parsePromptCsv(VALID);

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(4);
    expect(result.rows[0]?.cluster).toBe("CRM comparison");
    expect(result.rows[3]?.isControl).toBe(true);
  });

  it("группирует в два кластера", () => {
    const groups = groupByCluster(parsePromptCsv(VALID).rows);

    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.prompts.length)).toEqual([2, 2]);
  });

  it("переживает CRLF и BOM", () => {
    const withBom = "﻿cluster,intent,prompt,is_control\r\nA,other,p,0\r\n";
    expect(parsePromptCsv(withBom).rows).toHaveLength(1);
  });

  it("запятая внутри промпта не ломает разбор", () => {
    const csv = 'cluster,intent,prompt,is_control\nA,other,"best CRM for small, fast teams",0';
    expect(parsePromptCsv(csv).rows[0]?.prompt).toBe("best CRM for small, fast teams");
  });

  it("неизвестный интент становится other, а не роняет импорт", () => {
    const csv = "cluster,intent,prompt,is_control\nA,nonsense,p,0";
    expect(parsePromptCsv(csv).rows[0]?.intent).toBe("other");
  });

  const booleanCases: [string, boolean][] = [
    ["true", true],
    ["TRUE", true],
    ["1", true],
    ["yes", true],
    ["false", false],
    ["0", false],
    ["", false],
  ];

  it.each(booleanCases)("is_control=%s -> %s", (raw, expected) => {
    const csv = `cluster,intent,prompt,is_control\nA,other,p,${raw}`;
    expect(parsePromptCsv(csv).rows[0]?.isControl).toBe(expected);
  });

  it("пустые обязательные поля дают ошибку с номером строки, а не тихий пропуск", () => {
    const csv = ["cluster,intent,prompt,is_control", "A,other,,0", ",other,p,0"].join("\n");
    const result = parsePromptCsv(csv);

    expect(result.rows).toHaveLength(0);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toContain("Line 2");
    expect(result.errors[1]).toContain("Line 3");
  });

  it("дубли внутри файла пропускаются, но о них сообщается", () => {
    const csv = [
      "cluster,intent,prompt,is_control",
      "A,other,same prompt,0",
      "A,other,Same Prompt,0",
    ].join("\n");
    const result = parsePromptCsv(csv);

    // Иначе счёт импортированных промптов не сойдётся с числом строк в файле.
    expect(result.rows).toHaveLength(1);
    expect(result.errors[0]).toContain("duplicate");
  });

  it("частично валидный файл импортируется, а не отвергается целиком", () => {
    const csv = ["cluster,intent,prompt,is_control", "A,other,good,0", "A,other,,0"].join("\n");
    const result = parsePromptCsv(csv);

    expect(result.rows).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
  });

  it("файл без заголовка отвергается с понятным сообщением", () => {
    expect(parsePromptCsv("A,other,p,0").errors[0]).toContain("Missing header");
  });

  it("отсутствие обязательной колонки названо явно", () => {
    expect(parsePromptCsv("intent,prompt\nother,p").errors[0]).toContain("required");
  });

  it("пустой файл не роняет импорт", () => {
    expect(parsePromptCsv("").errors[0]).toContain("empty");
  });

  it("колонки могут идти в любом порядке", () => {
    const csv = "prompt,is_control,cluster,intent\np,1,A,purchase";
    const row = parsePromptCsv(csv).rows[0];

    expect(row?.cluster).toBe("A");
    expect(row?.intent).toBe("purchase");
    expect(row?.isControl).toBe(true);
  });
});
