// Semáforos: se comparan principalmente contra la meta del mismo período, al ritmo
// esperado a la fecha. Sin datos no hay color; con pocos casos tampoco (no se acusa
// fracaso por una muestra chica).

export type Light = "verde" | "amarillo" | "rojo" | "sin_datos" | "muestra_chica";

export interface Thresholds {
  /** Proporción del esperado para verde (1 = llegar al ritmo). */
  green: number;
  /** Proporción del esperado para amarillo. */
  yellow: number;
  /** Casos mínimos (consultas, oportunidades…) para colorear. */
  minSample: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = { green: 1, yellow: 0.8, minSample: 10 };

export function trafficLight(input: {
  actual: number | null;
  target: number | null;
  /** Parte del período que ya pasó (0 a 1): el ritmo esperado a hoy. */
  expectedFraction?: number;
  /** Cantidad de casos detrás del valor (por ejemplo, consultas del período). */
  sample: number | null;
  thresholds: Thresholds;
  /** Para costos: menos es mejor. */
  lowerIsBetter?: boolean;
}): Light {
  const { actual, target, sample, thresholds } = input;
  if (actual === null || target === null || target <= 0 || sample === null) return "sin_datos";
  if (sample < thresholds.minSample) return "muestra_chica";
  const expected = target * (input.expectedFraction ?? 1);
  if (expected <= 0) return "sin_datos";
  const ratio = input.lowerIsBetter ? (actual === 0 ? Infinity : expected / actual) : actual / expected;
  if (ratio >= thresholds.green) return "verde";
  if (ratio >= thresholds.yellow) return "amarillo";
  return "rojo";
}

export const LIGHT_LABEL: Record<Light, string> = {
  verde: "En camino",
  amarillo: "Atención",
  rojo: "Debajo de lo esperado",
  sin_datos: "Sin datos",
  muestra_chica: "Muestra chica",
};
