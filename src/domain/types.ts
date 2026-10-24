// Modelo de dominio de MDM OS. Sin dependencias de base de datos ni de pantallas:
// las reglas comerciales se calculan sobre estos objetos y se testean aisladas.

/** Código ISO 4217 (ARS, USD, CLP, GTQ...). */
export type CurrencyCode = string;

/** Importe en unidades mínimas (centavos) para no acumular errores de decimales. */
export interface Money {
  amount: number;
  currency: CurrencyCode;
}

/** Fecha local del negocio, formato YYYY-MM-DD. */
export type LocalDate = string;

/** Instante en ISO 8601 con zona (2026-04-03T15:00:00Z). */
export type Instant = string;

export type Stage =
  | "nueva_consulta"
  | "presupuestado"
  | "en_seguimiento"
  | "senado"
  | "ganado_en_reparacion"
  | "ganado_completado"
  | "perdido";

export type LeadSource =
  | "organico"
  | "meta_ads"
  | "prospeccion"
  | "referido"
  | "directo"
  | "desconocido"
  | "otro";

export type Actor = "usuario" | "mentor" | "ia" | "importacion";

export interface Business {
  id: string;
  name: string;
  timezone: string;
  currency: CurrencyCode;
  /** Cotización que el alumno carga a mano: moneda local por 1 USD. */
  usdRate: number | null;
  /** Si es false, la seña de una oportunidad perdida queda retenida por defecto. */
  depositsRefundable: boolean;
}

export interface Contact {
  id: string;
  businessId: string;
  name: string | null;
}

/** consulta: entró como consulta. venta_directa: venta sin consulta previa registrada. */
export type EntryKind = "consulta" | "venta_directa";

export type LostCategory = "precio" | "sin_respuesta" | "eligio_otro" | "no_reparable" | "cancelacion_tecnica" | "otro";

export type AttributionConfidence = "confirmada" | "declarada" | "inferida";

/** De dónde vino el registro: cargado a mano o por una importación. */
export type DataChannel = "manual" | "archivo" | "google_sheets" | "conector";

export interface Opportunity {
  id: string;
  businessId: string;
  contactId: string;
  createdAt: Instant;
  stage: Stage;
  source: LeadSource;
  /** Fecha en que el usuario confirmó la pérdida. */
  lostAt: Instant | null;
  /** Embudo principal; null o ausente = Sin atribuir. */
  funnelId?: string | null;
  attributionConfidence?: AttributionConfidence | null;
  /** Ausente = consulta (datos anteriores a V1.3). */
  entryKind?: EntryKind;
  lostCategory?: LostCategory | null;
  channel?: DataChannel;
}

export type SaleStatus = "vigente" | "revertida";

export interface Sale {
  id: string;
  businessId: string;
  opportunityId: string;
  contactId: string;
  /** Monto pactado original. Los ajustes no lo modifican: se registran aparte. */
  amount: Money;
  /** null = todavía no se cargó (la contribución queda "Sin datos"). */
  directCost: Money | null;
  variableCosts: Money | null;
  wonAt: Instant;
  status: SaleStatus;
  /** Cotización del negocio (moneda local por 1 USD) vigente al registrar la venta. */
  usdRate: number | null;
}

export type PaymentKind = "sena" | "anticipo" | "saldo" | "pago_total" | "devolucion";

export interface Payment {
  id: string;
  businessId: string;
  opportunityId: string;
  /** null mientras la seña está asociada solo a la oportunidad. */
  saleId: string | null;
  /** Siempre positivo; una devolución resta por su tipo. */
  amount: Money;
  kind: PaymentKind;
  paidAt: Instant;
  /** En una devolución, el cobro original que devuelve. */
  refundsPaymentId: string | null;
  /** Cotización del negocio (moneda local por 1 USD) vigente al registrar el cobro. */
  usdRate: number | null;
}

export type AdjustmentKind = "anulacion" | "devolucion_parcial";

export interface SaleAdjustment {
  id: string;
  saleId: string;
  kind: AdjustmentKind;
  /** Cambio sobre el monto pactado; negativo en una devolución parcial. */
  amountDelta: Money;
  at: Instant;
  reason: string;
}

export type TallyMethod = "manual" | "importado" | "whatsapp";

/** Total de consultas calificadas de un día, cargado a mano o detectado. */
export interface InquiryTally {
  id: string;
  businessId: string;
  date: LocalDate;
  count: number;
  method: TallyMethod;
}

export interface Period {
  from: LocalDate;
  to: LocalDate;
}

export type StepUnit = "cantidad" | "personas" | "horas" | "dinero";

export interface FunnelStepDef {
  key: string;
  label: string;
  unit: StepUnit;
}

export interface FunnelVersion {
  id: string;
  version: number;
  validFrom: LocalDate;
  steps: FunnelStepDef[];
  notes: string | null;
}

export type FunnelStatus = "activo" | "pausado" | "archivado";

export interface Funnel {
  id: string;
  name: string;
  /** null = embudo a medida. */
  templateKey: string | null;
  channel: LeadSource;
  status: FunnelStatus;
  allowsDirectSales: boolean;
  /** Ordenadas de la más vieja a la más nueva. */
  versions: FunnelVersion[];
}

export interface FunnelActivity {
  id: string;
  funnelId: string;
  versionId: string;
  occurredOn: LocalDate;
  periodEnd: LocalDate | null;
  label: string | null;
  values: Record<string, number>;
  quality: "real" | "estimado";
  channel: DataChannel;
}

/** Todos los registros de un negocio que alimentan las métricas. */
export interface BusinessData {
  business: Business;
  opportunities: Opportunity[];
  sales: Sale[];
  payments: Payment[];
  adjustments: SaleAdjustment[];
  tallies: InquiryTally[];
  /** Oportunidades que recibieron al menos un presupuesto (para el embudo). */
  quotedOpportunityIds?: string[];
  funnels?: Funnel[];
  activities?: FunnelActivity[];
}
