import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "./client";
import {
  createAgency,
  createClient,
  createRun,
  deleteAgency,
  failRunIfInFlight,
  finishRunWithNote,
  getRunById,
} from "./queries";

/**
 * Запоздалый обработчик сбоя сборки не должен затирать закончившийся прогон:
 * «failed» пишется только поверх идущего.
 */

const { db, close } = createDb();

afterAll(async () => {
  await close();
});

describe("failRunIfInFlight", () => {
  it("закрывает идущий прогон и не трогает законченный", async () => {
    const agency = await createAgency(db, { name: "Fail Run Agency", clientLimit: 3 });
    try {
      const client = await createClient(db, {
        agencyId: agency.id,
        name: "Fail Run Client",
        domain: "fail-run.test",
      });
      const base = { clientId: client.id, trigger: "manual" as const, adaptersMode: "mock" as const };

      const running = await createRun(db, { ...base, status: "running" });
      expect(await failRunIfInFlight(db, running.id, "Assembly failed.")).toBe(true);
      const failed = await getRunById(db, running.id);
      expect(failed?.status).toBe("failed");
      expect(failed?.note).toBe("Assembly failed.");

      const done = await createRun(db, { ...base, status: "running" });
      await finishRunWithNote(db, done.id, "done", null);
      expect(await failRunIfInFlight(db, done.id, "Assembly failed.")).toBe(false);
      const kept = await getRunById(db, done.id);
      expect(kept?.status).toBe("done");
      expect(kept?.note).toBeNull();
    } finally {
      await deleteAgency(db, agency.id);
    }
  });
});
