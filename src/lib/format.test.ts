import { describe, expect, it } from "vitest";
import { parseAmount } from "./format";

describe("parseAmount", () => {
  it("entiende formato argentino y simple", () => {
    expect(parseAmount("150.000")).toBe(15_000_000);
    expect(parseAmount("150.000,50")).toBe(15_000_050);
    expect(parseAmount("1450.5")).toBe(145_050);
    expect(parseAmount("$ 20000")).toBe(2_000_000);
  });

  it("vacío o negativo da null", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("-5")).toBeNull();
    expect(parseAmount(null)).toBeNull();
  });
});
