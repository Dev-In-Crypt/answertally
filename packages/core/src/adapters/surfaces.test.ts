import { describe, expect, it } from "vitest";
import { ASSISTANTS } from "./catalogue";
import { isPlatform } from "./registry";
import { PLATFORM_IDS } from "./types";
import { capabilitiesFor } from "../config/measurement";
import {
  SurfaceProviderNotConfiguredError,
  UnconfiguredSerpProvider,
  surfaceCapabilities,
} from "./surfaces";

/**
 * Verify: поверхности, которые мы пока не измеряем.
 *
 * Главное свойство — отрицательное: пока провайдера нет, поверхность не
 * должна отдавать ни одной цифры. Заглушка с правдоподобными ответами попала
 * бы в срезы и стала бы измерением, которого не было.
 */

describe("surfaceCapabilities", () => {
  it("описывает каждую поверхность из каталога", () => {
    expect(surfaceCapabilities()).toHaveLength(ASSISTANTS.length);
  });

  it("у каждой неизмеряемой поверхности сказано, чего именно не хватает", () => {
    for (const surface of surfaceCapabilities().filter((entry) => !entry.measurable)) {
      expect(surface.requirement).not.toBe("none");
      expect(surface.note.trim().length).toBeGreaterThan(0);
    }
  });

  it("поверхности Google измеряются через поставщика выдачи", () => {
    // С 07.10.2026: у Google API нет, ответы снимает DataForSEO (adapters/dataforseo).
    const google = surfaceCapabilities().filter((entry) => entry.id.startsWith("ai-"));

    expect(google.length).toBe(2);
    for (const surface of google) {
      expect(surface.requirement).toBe("none");
      expect(surface.measurable).toBe(true);
      expect(surface.note).toContain("data provider");
    }
  });

  it("остальная система готова принять поверхность, как только появится провайдер", () => {
    for (const surface of surfaceCapabilities()) {
      expect(surface.pipelineReady).toBe(true);
    }
  });

  it("Copilot тоже ждёт поставщика выдачи, а не ключа", () => {
    // Bing Search API отключён 11.08.2025, а Grounding with Bing — инструмент
    // для своего агента, а не ответ Copilot (см. docs/cost-model.md, §5).
    // Ключ здесь не поможет: поверхность не отдаёт свой ответ программно.
    const copilot = surfaceCapabilities().find((entry) => entry.id === "copilot");

    expect(copilot?.measurable).toBe(false);
    expect(copilot?.requirement).toBe("serp-provider");
  });

  it("неизмеряемую поверхность не разрешает ни один тариф", () => {
    /**
     * Защита от выдуманной цифры. Раньше она читалась проще: неизмеряемой
     * поверхности нет в enum базы, значит её негде и поставить.
     *
     * Так больше не везде. Перестать измерять можно и ту платформу, по
     * которой ответы уже записаны, — значение остаётся в enum, потому что
     * на него ссылаются строки, а удалять данные мы не удаляем. Поэтому
     * проверяется то, что важно на самом деле: в расписание её не поставить.
     */
    const unmeasured = surfaceCapabilities().filter((entry) => !entry.measurable);

    expect(unmeasured.length).toBeGreaterThan(0);
    for (const surface of unmeasured) {
      for (const plan of ["starter", "growth", "scale"] as const) {
        expect(capabilitiesFor(plan).assistants as readonly string[]).not.toContain(surface.id);
        expect(capabilitiesFor(plan).defaultAssistants as readonly string[]).not.toContain(
          surface.id,
        );
      }
    }
  });

  it("поверхность без адаптера не существует и для базы", () => {
    // У тех, кого мы не измеряли никогда, нет и значения в enum: ни одна
    // строка на него не сошлётся.
    for (const id of ["copilot"]) {
      expect(PLATFORM_IDS as readonly string[]).not.toContain(id);
      expect(isPlatform(id)).toBe(false);
    }
  });

  it("ни одно описание не обещает причинности", () => {
    for (const surface of surfaceCapabilities()) {
      expect(surface.note).not.toMatch(/proof|proven|guarantee|caused/i);
    }
  });
});

describe("UnconfiguredSerpProvider", () => {
  it("отказывается отвечать вместо того, чтобы выдумать ответ", async () => {
    const provider = new UnconfiguredSerpProvider();

    await expect(
      provider.fetchAnswer({ query: "best CRM for startups", surface: "ai-overviews" }),
    ).rejects.toBeInstanceOf(SurfaceProviderNotConfiguredError);
  });
});
