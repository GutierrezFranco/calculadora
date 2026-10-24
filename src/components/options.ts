export const LEAD_SOURCE_OPTIONS = [
  ["desconocido", "No sé"],
  ["organico", "Orgánico (Instagram, TikTok…)"],
  ["meta_ads", "Anuncios de Meta"],
  ["referido", "Recomendación"],
  ["directo", "Pasó por el local"],
  ["prospeccion", "Prospección"],
  ["otro", "Otro"],
] as const;

export const PAYMENT_KIND_LABELS: Record<string, string> = {
  sena: "Seña",
  anticipo: "Anticipo",
  saldo: "Saldo",
  pago_total: "Pago total",
  devolucion: "Devolución",
};
