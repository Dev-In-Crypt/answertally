import { describe, expect, it } from "vitest";
import { clientFormProblem, type ClientFormValues } from "./client-form";

const ok: ClientFormValues = {
  name: "Acme",
  domain: "acme.com",
  industry: "",
  category: "",
  brandNames: ["Acme"],
  competitorNames: ["Globex"],
  isProspect: false,
};

describe("clientFormProblem", () => {
  const cases: [string, Partial<ClientFormValues>, RegExp | null][] = [
    ["валидная форма", {}, null],
    ["домен из адресной строки", { domain: "https://www.acme.com/pricing" }, null],
    ["домен без точки", { domain: "acme" }, /Enter a domain/],
    ["схема без точки в хосте", { domain: "https://localhost/x.html" }, /Enter a domain/],
    ["длинное имя клиента", { name: "x".repeat(201) }, /at most 200/],
    ["60 конкурентов", { competitorNames: Array.from({ length: 60 }, (_, i) => `C${i}`) }, /at most 50 competitors \(you have 60\)/],
    ["длинный бренд", { brandNames: ["b".repeat(101)] }, /brand names can be at most 100/],
  ];

  for (const [title, patch, expected] of cases) {
    it(title, () => {
      const problem = clientFormProblem({ ...ok, ...patch });
      if (expected) expect(problem).toMatch(expected);
      else expect(problem).toBeNull();
    });
  }
});
