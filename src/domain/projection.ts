// Ingeniería inversa de objetivos (sección 6 de la especificación): desde una meta de
// facturación o contribución, cuántas ventas, consultas, inversión y contactos hacen falta.
// Cada supuesto dice si sale de datos reales o es una estimación del alumno.

export type Origin = "real" | "estimado";

export interface Assumption {
  value: number | null;
  origin: Origin;
}

export interface ProjectionInputs {
  goalKind: "facturacion" | "contribucion";
  /** Meta mensual en centavos de la moneda local. */
  goal: number;
  /** Ticket promedio en centavos. */
  ticket: Assumption;
  /** Ventas / consultas calificadas (0 a 1). */
  closeRate: Assumption;
  /** Contribución / facturación (0 a 1). Solo para metas de contribución. */
  margin: Assumption;
  /** Parte de las consultas que llega por anuncios (0 a 1). */
  paidShare: Assumption;
  /** Costo por consulta calificada de anuncios, en centavos. */
  costPerInquiry: Assumption;
  /** Consultas orgánicas por cada visita al perfil (0 a 1). Hipotético: no es atribución. */
  inquiriesPerVisit: Assumption;
  /** Parte de las ventas que se busca por prospección (0 a 1). */
  prospectShare: Assumption;
  /** Prospectos contactados que terminan comprando (0 a 1): respuesta × interés × cierre. */
  prospectConversion: Assumption;
}

export interface ProjectionResult {
  revenueNeeded: number | null;
  salesNeeded: number | null;
  salesFromProspecting: number | null;
  salesFromInquiries: number | null;
  inquiriesNeeded: number | null;
  paidInquiries: number | null;
  organicInquiries: number | null;
  adBudget: number | null;
  profileVisitsNeeded: number | null;
  prospectContactsNeeded: number | null;
  /** Qué falta cargar para completar el cálculo. */
  missing: string[];
}

const ok = (a: Assumption, min = 0) => a.value !== null && Number.isFinite(a.value) && a.value > min;

export function project(input: ProjectionInputs): ProjectionResult {
  const missing: string[] = [];
  const need = (a: Assumption, label: string) => {
    if (!ok(a)) missing.push(label);
    return ok(a) ? a.value! : null;
  };

  let revenueNeeded: number | null = input.goal;
  if (input.goalKind === "contribucion") {
    const margin = need(input.margin, "margen de contribución");
    revenueNeeded = margin === null ? null : Math.ceil(input.goal / margin);
  }
  const ticket = need(input.ticket, "ticket promedio");
  const salesNeeded = revenueNeeded !== null && ticket !== null ? Math.ceil(revenueNeeded / ticket) : null;

  // Prospección es opcional: sin datos, todas las ventas salen de consultas.
  const prospectShare = ok(input.prospectShare) ? Math.min(input.prospectShare.value!, 1) : 0;
  const salesFromProspecting = salesNeeded === null ? null : Math.round(salesNeeded * prospectShare);
  const salesFromInquiries = salesNeeded === null || salesFromProspecting === null ? null : salesNeeded - salesFromProspecting;

  let inquiriesNeeded: number | null = null;
  if (salesFromInquiries === 0) inquiriesNeeded = 0;
  else if (salesFromInquiries !== null) {
    const closeRate = need(input.closeRate, "tasa de cierre");
    inquiriesNeeded = closeRate === null ? null : Math.ceil(salesFromInquiries / Math.min(closeRate, 1));
  }

  const paidShare = ok(input.paidShare) ? Math.min(input.paidShare.value!, 1) : 0;
  const paidInquiries = inquiriesNeeded === null ? null : Math.ceil(inquiriesNeeded * paidShare);
  const organicInquiries = inquiriesNeeded === null || paidInquiries === null ? null : inquiriesNeeded - paidInquiries;

  let adBudget: number | null = null;
  if (paidInquiries === 0) adBudget = 0;
  else if (paidInquiries !== null) {
    const cost = need(input.costPerInquiry, "costo por consulta de anuncios");
    adBudget = cost === null ? null : paidInquiries * cost;
  }

  const profileVisitsNeeded =
    organicInquiries !== null && ok(input.inquiriesPerVisit) ? Math.ceil(organicInquiries / input.inquiriesPerVisit.value!) : null;

  let prospectContactsNeeded: number | null = null;
  if (salesFromProspecting === 0) prospectContactsNeeded = 0;
  else if (salesFromProspecting !== null) {
    const conversion = need(input.prospectConversion, "conversión de prospección");
    prospectContactsNeeded = conversion === null ? null : Math.ceil(salesFromProspecting / conversion);
  }

  return {
    revenueNeeded,
    salesNeeded,
    salesFromProspecting,
    salesFromInquiries,
    inquiriesNeeded,
    paidInquiries,
    organicInquiries,
    adBudget,
    profileVisitsNeeded,
    prospectContactsNeeded,
    missing,
  };
}

/** Consultas necesarias si el ticket y la tasa de cierre se mueven un poco. */
export function sensitivity(input: ProjectionInputs): { ticketFactor: number; closeDelta: number; inquiries: number | null }[] {
  const cells: { ticketFactor: number; closeDelta: number; inquiries: number | null }[] = [];
  for (const ticketFactor of [0.9, 1, 1.1]) {
    for (const closeDelta of [-0.05, 0, 0.05]) {
      const ticket = input.ticket.value === null ? null : Math.round(input.ticket.value * ticketFactor);
      const close = input.closeRate.value === null ? null : Math.max(input.closeRate.value + closeDelta, 0.01);
      cells.push({
        ticketFactor,
        closeDelta,
        inquiries: project({ ...input, ticket: { ...input.ticket, value: ticket }, closeRate: { ...input.closeRate, value: close } })
          .inquiriesNeeded,
      });
    }
  }
  return cells;
}
