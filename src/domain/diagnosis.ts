// Diagnóstico de cuellos de botella. Cada regla exige datos suficientes: sin datos o con
// muestras chicas no se emite ningún diagnóstico (criterio 11). Los umbrales son
// iniciales y se pueden ajustar con la experiencia del programa.
import type { FunnelStep } from "./funnel";
import type { PeriodMetrics } from "./metrics";

export type Severity = "alta" | "media" | "info";

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  action: string;
}

export interface DiagnosisInput {
  metrics: PeriodMetrics;
  previous: PeriodMetrics;
  funnel: FunnelStep[];
  currency: string;
  /** Días del período con total de consultas cargado, y días del período. */
  daysLoaded: number;
  days: number;
  /** Oportunidades abiertas con seguimiento vencido. */
  overdueFollowUps: number;
  /** Oportunidades abiertas sin interacción hace más de 14 días. */
  staleOpen: number;
  minSample: number;
}

const pct = (r: number) => `${Math.round(r * 100)} %`;
const ORDER: Record<Severity, number> = { alta: 0, media: 1, info: 2 };

export function diagnose(input: DiagnosisInput): Finding[] {
  const { metrics: m, previous: p, funnel, minSample } = input;
  if (m.consultasCalificadas === null) {
    return [
      {
        id: "sin_datos",
        severity: "info",
        title: "Sin datos en este período",
        detail: "No hay consultas, oportunidades ni ventas cargadas.",
        action: "Cargá las consultas del día y tus ventas para ver el diagnóstico.",
      },
    ];
  }

  const findings: Finding[] = [];
  const step = (label: string) => funnel.find((s) => s.label === label)?.count ?? null;

  if (input.days > 0 && input.daysLoaded / input.days < 0.5) {
    findings.push({
      id: "carga_incompleta",
      severity: "media",
      title: "Carga de consultas incompleta",
      detail: `Cargaste el total de consultas ${input.daysLoaded} de ${input.days} días. Las tasas pueden estar distorsionadas.`,
      action: "Cargá las consultas todos los días (lleva un minuto) o importalas desde tu planilla.",
    });
  }

  const opps = step("Oportunidades");
  const quoted = step("Presupuestadas");
  if (opps !== null && quoted !== null && opps >= minSample && quoted / opps < 0.5) {
    findings.push({
      id: "poco_presupuesto",
      severity: "alta",
      title: "Muchas oportunidades no llegan a presupuesto",
      detail: `Solo ${pct(quoted / opps)} de las oportunidades del período recibió un presupuesto.`,
      action: "Respondé cada consulta con un precio o un rango concreto y registralo.",
    });
  }

  const close = m.tasaCierre;
  if (close && close.ratio !== null && close.ganadas + close.perdidas >= minSample) {
    if (close.ratio < 0.25) {
      findings.push({
        id: "cierre_bajo",
        severity: "alta",
        title: "Tasa de cierre baja",
        detail: `Se gana ${pct(close.ratio)} de las oportunidades decididas (${close.ganadas} de ${close.ganadas + close.perdidas}).`,
        action: "Revisá los motivos de pérdida: si es precio, trabajá la presentación del valor; si es demora, el seguimiento.",
      });
    }
    const prev = p.tasaCierre;
    if (prev && prev.ratio !== null && prev.ganadas + prev.perdidas >= minSample && prev.ratio > 0 && close.ratio < prev.ratio * 0.8) {
      findings.push({
        id: "cierre_bajo_vs_anterior",
        severity: "media",
        title: "La tasa de cierre bajó",
        detail: `Pasó de ${pct(prev.ratio)} a ${pct(close.ratio)} respecto del período anterior.`,
        action: "Compará qué cambió: precios, tiempos de respuesta o el tipo de consultas que llegan.",
      });
    }
  }

  if (close && close.pendientes >= minSample && close.pendientes > close.ganadas + close.perdidas) {
    findings.push({
      id: "muchos_pendientes",
      severity: "media",
      title: "Muchas oportunidades sin decidir",
      detail: `Hay ${close.pendientes} oportunidades abiertas, más que las decididas en el período.`,
      action: "Hacé seguimiento y marcá como perdidas las que ya no van (\"lo voy a pensar\" sigue abierta).",
    });
  }

  if (input.overdueFollowUps > 0) {
    findings.push({
      id: "seguimientos_vencidos",
      severity: input.overdueFollowUps >= 5 ? "alta" : "media",
      title: "Seguimientos vencidos",
      detail: `${input.overdueFollowUps} oportunidades tienen el seguimiento vencido.`,
      action: "Escribiles hoy: es la forma más barata de recuperar ventas.",
    });
  }

  if (input.staleOpen >= Math.max(3, Math.ceil(minSample / 2))) {
    findings.push({
      id: "abiertas_viejas",
      severity: "info",
      title: "Oportunidades estancadas",
      detail: `${input.staleOpen} oportunidades abiertas no tienen movimiento hace más de 14 días.`,
      action: "Retomalas o cerralas como perdidas para que la tasa de cierre sea real.",
    });
  }

  const consultas = m.consultasCalificadas;
  const consultasPrev = p.consultasCalificadas;
  if (consultasPrev !== null && consultasPrev >= minSample && consultas < consultasPrev * 0.75) {
    findings.push({
      id: "menos_consultas",
      severity: "media",
      title: "Bajaron las consultas",
      detail: `${consultas} consultas contra ${consultasPrev} del período anterior.`,
      action: "Revisá qué cambió en tu captación: frecuencia de contenido, anuncios pausados o temporada.",
    });
  }

  const local = (t: Record<string, number | undefined> | null) => (t ? t[input.currency] ?? 0 : 0);
  const ventas = m.ventasGanadas ?? 0;
  if (ventas >= Math.ceil(minSample / 2) && local(m.saldoPendiente) > local(m.facturacionPactada) * 0.3) {
    findings.push({
      id: "saldo_alto",
      severity: "media",
      title: "Mucho saldo sin cobrar",
      detail: "Más del 30 % de lo vendido en el período todavía no se cobró.",
      action: "Cobrá al entregar y registrá los saldos para que el cobrado sea real.",
    });
  }

  if (ventas >= Math.ceil(minSample / 2) && m.contribucion === null) {
    findings.push({
      id: "sin_costos",
      severity: "info",
      title: "Faltan costos para calcular la contribución",
      detail: "Ninguna venta del período tiene el costo directo cargado.",
      action: "Cargá el costo del repuesto en cada venta para saber cuánto te queda realmente.",
    });
  }

  return findings.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}

export interface MentorAlertInput {
  metrics: PeriodMetrics;
  previous: PeriodMetrics;
  daysLoaded: number;
  days: number;
  /** Días desde el último cambio cargado; null si nunca cargó nada. */
  daysSinceUpdate: number | null;
  staleOpen: number;
  minSample: number;
}

/** Alertas prudentes para el panel del mentor. */
export function mentorAlerts(input: MentorAlertInput): string[] {
  const alerts: string[] = [];
  const { metrics: m, previous: p, minSample } = input;
  if (input.daysSinceUpdate === null) return ["Nunca cargó datos"];
  if (input.daysSinceUpdate >= 7) alerts.push(`Sin actividad hace ${input.daysSinceUpdate} días`);
  if (input.days > 0 && input.daysLoaded / input.days < 0.5) alerts.push("Carga de consultas incompleta");
  const worse = (now: number | null, before: number | null) =>
    now !== null && before !== null && before >= minSample && now < before * 0.75;
  if (worse(m.consultasCalificadas, p.consultasCalificadas)) alerts.push("Bajaron las consultas");
  if (worse(m.ventasGanadas, p.ventasGanadas)) alerts.push("Bajaron las ventas");
  if (input.staleOpen >= Math.max(3, Math.ceil(minSample / 2))) alerts.push(`${input.staleOpen} oportunidades estancadas`);
  return alerts;
}
