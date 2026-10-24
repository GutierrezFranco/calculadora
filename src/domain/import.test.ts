import { describe, expect, it } from "vitest";
import { guessMapping, parseAmountCell, parseDateCell, parseSales, parseTallies } from "./import";

const options = {
  timezone: "America/Argentina/Buenos_Aires",
  currency: "ARS",
  today: "2026-10-24",
  normalizePhone: (raw: string) => (raw.replace(/\D/g, "").length >= 8 ? `+54${raw.replace(/\D/g, "")}` : null),
};

describe("guessMapping", () => {
  it("reconoce encabezados comunes de planillas de servicio técnico", () => {
    const headers = ["Fecha", "Cliente", "Teléfono", "Equipo / reparación", "Total", "Monto cobrado", "Costo repuesto", "Moneda"];
    expect(guessMapping(headers, "ventas")).toEqual({
      fecha: 0, cliente: 1, telefono: 2, descripcion: 3, monto: 4, cobrado: 5, costo: 6, moneda: 7,
    });
  });

  it("para consultas busca fecha y cantidad", () => {
    expect(guessMapping(["Día", "Mensajes recibidos"], "consultas")).toEqual({ fecha: 0, consultas: 1 });
  });
});

describe("celdas", () => {
  it("fechas en varios formatos", () => {
    expect(parseDateCell(new Date(Date.UTC(2026, 2, 5)))).toBe("2026-03-05");
    expect(parseDateCell("05/03/2026")).toBe("2026-03-05");
    expect(parseDateCell("5-3-26")).toBe("2026-03-05");
    expect(parseDateCell("2026-03-05 14:30")).toBe("2026-03-05");
    expect(parseDateCell(46086)).toBe("2026-03-05"); // número de serie de Excel
    expect(parseDateCell("31/02/2026")).toBeNull();
    expect(parseDateCell("ayer")).toBeNull();
  });

  it("montos en varios formatos", () => {
    expect(parseAmountCell(150000)).toBe(15_000_000);
    expect(parseAmountCell("$ 150.000")).toBe(15_000_000);
    expect(parseAmountCell("150.000,50")).toBe(15_000_050);
    expect(parseAmountCell("US$ 100")).toBe(10_000);
    expect(parseAmountCell("")).toBeNull();
  });
});

describe("parseSales", () => {
  const mapping = { fecha: 0, monto: 1, cobrado: 2, cliente: 3, telefono: 4 };

  it("separa filas válidas, errores y vacías", () => {
    const result = parseSales(
      [
        ["05/03/2026", "$ 100.000", "50.000", "Ana", "11 2345 6789"],
        ["06/03/2026", 20000, null, null, null],
        [null, null, null, null, null],
        ["fecha mala", 100, null, null, null],
        ["07/03/2026", 100, 200, null, null],
        ["01/12/2026", 100, null, null, null],
        ["08/03/2026", "US$ 50", null, null, null],
      ],
      mapping,
      options,
    );
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toMatchObject({ monto: 10_000_000, cobrado: 5_000_000, cliente: "Ana", telefono: "+541123456789", moneda: "ARS" });
    expect(result.rows[0].fecha).toBe("2026-03-05T15:00:00.000Z");
    expect(result.rows[1]).toMatchObject({ monto: 2_000_000, cobrado: null });
    expect(result.rows[2]).toMatchObject({ monto: 5_000, moneda: "USD" });
    expect(result.skipped).toBe(1);
    expect(result.errors).toEqual([
      { row: 5, message: "fecha ilegible" },
      { row: 6, message: "cobrado mayor que el monto" },
      { row: 7, message: "fecha futura" },
    ]);
  });
});

describe("parseTallies", () => {
  it("suma filas del mismo día y ordena por fecha", () => {
    const result = parseTallies(
      [
        ["02/03/2026", 5],
        ["01/03/2026", "3"],
        ["02/03/2026", 2],
        ["03/03/2026", "muchas"],
      ],
      { fecha: 0, consultas: 1 },
      options,
    );
    expect(result.rows).toEqual([
      { fecha: "2026-03-01", consultas: 3 },
      { fecha: "2026-03-02", consultas: 7 },
    ]);
    expect(result.errors).toEqual([{ row: 5, message: "cantidad inválida" }]);
  });
});
