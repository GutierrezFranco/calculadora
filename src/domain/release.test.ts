import { describe, expect, it } from "vitest";
import { releasePr, RELEASE_PR } from "./release";

describe("PR de la compilación mostrada", () => {
  it("muestra el PR de preview aunque su base sea otro PR", () => {
    expect(releasePr("12", "Merge pull request #9 from example/branch")).toBe(12);
  });
  it("reconoce el merge de main", () => {
    expect(releasePr("", "Merge pull request #20 from example/branch\n\nDescripción")).toBe(20);
  });
  it("reconoce squash merge", () => {
    expect(releasePr(undefined, "Mejora de carga (#60)")).toBe(60);
  });
  it("no confunde referencias a otros PR con la versión desplegada", () => {
    expect(releasePr(undefined, "Corrige lo informado en #99")).toBe(RELEASE_PR);
  });
  it("usa respaldo explícito cuando no hay metadatos o son inválidos", () => {
    expect(releasePr()).toBe(9);
    expect(releasePr("0", "Descripción")).toBe(9);
  });
});
