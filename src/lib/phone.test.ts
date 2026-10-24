import { describe, expect, it } from "vitest";
import { normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it("completa el prefijo del país del negocio", () => {
    expect(normalizePhone("11 2345-6789", "America/Argentina/Buenos_Aires")).toBe("+541123456789");
    expect(normalizePhone("+56 9 1234 5678", "America/Argentina/Buenos_Aires")).toBe("+56912345678");
  });

  it("vacío o inválido da null", () => {
    expect(normalizePhone("", "America/Santiago")).toBeNull();
    expect(normalizePhone("abc", "America/Santiago")).toBeNull();
  });
});
