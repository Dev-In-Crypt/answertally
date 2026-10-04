import { describe, expect, it } from "vitest";
import { runOutcome } from "./finalize-run";

/**
 * Итог прогона по числу дошедших ответов. Раньше один потерянный ответ
 * делал failed весь прогон, и аудит прятал уже посчитанные цифры.
 */
describe("runOutcome", () => {
  it.each([
    // written, expected, status, note
    [144, 144, "done", null],
    [143, 144, "done", /143 of 144 answers came back/],
    [72, 144, "done", /72 of 144/],
    [71, 144, "failed", /Only 71 of 144/],
    [0, 144, "failed", /No answers came back/],
  ] as const)("%i из %i → %s", (written, expected, status, note) => {
    const outcome = runOutcome(written, expected);
    expect(outcome.status).toBe(status);
    if (note === null) expect(outcome.note).toBeNull();
    else expect(outcome.note).toMatch(note);
  });

  it("о неспрошенном ассистенте говорится и у полного прогона", () => {
    const outcome = runOutcome(48, 48, ["grok"]);
    expect(outcome.status).toBe("done");
    expect(outcome.note).toBe("Grok was not asked: not available right now.");
  });
});
