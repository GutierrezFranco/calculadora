import { describe, expect, it } from "vitest";
import { instantAt, localDate } from "./dates";

describe("instantAt", () => {
  it("convierte una hora local del negocio a instante", () => {
    expect(instantAt("2026-04-10", 12, "America/Argentina/Buenos_Aires")).toBe("2026-04-10T15:00:00.000Z");
    expect(instantAt("2026-01-10", 12, "Europe/Madrid")).toBe("2026-01-10T11:00:00.000Z");
    expect(instantAt("2026-07-10", 12, "Europe/Madrid")).toBe("2026-07-10T10:00:00.000Z");
  });

  it("vuelve a dar la misma fecha local", () => {
    const at = instantAt("2026-04-10", 23, "America/Guatemala");
    expect(localDate(at, "America/Guatemala")).toBe("2026-04-10");
  });
});
