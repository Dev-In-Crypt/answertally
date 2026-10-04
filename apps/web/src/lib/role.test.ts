import { describe, expect, it } from "vitest";
import { roleAtLeast, toRole } from "./role";

describe("роль в интерфейсе", () => {
  it("сравнивает так же, как roleProcedure", () => {
    expect(roleAtLeast("owner", "admin")).toBe(true);
    expect(roleAtLeast("admin", "admin")).toBe(true);
    expect(roleAtLeast("member", "admin")).toBe(false);
    expect(roleAtLeast("admin", "owner")).toBe(false);
    expect(roleAtLeast("member", "member")).toBe(true);
  });

  it("неизвестная роль — самая узкая", () => {
    expect(toRole("owner")).toBe("owner");
    expect(toRole("admin")).toBe("admin");
    expect(toRole(undefined)).toBe("member");
    expect(toRole("superuser")).toBe("member");
  });
});
