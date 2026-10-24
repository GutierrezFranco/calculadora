// Prefijo internacional por zona horaria del negocio, para completar números cargados sin "+".
const COUNTRY_CODE: Record<string, string> = {
  "America/Argentina/Buenos_Aires": "54",
  "America/Santiago": "56",
  "America/Montevideo": "598",
  "America/Asuncion": "595",
  "America/La_Paz": "591",
  "America/Lima": "51",
  "America/Bogota": "57",
  "America/Mexico_City": "52",
  "America/Guatemala": "502",
  "Europe/Madrid": "34",
};

/** Normaliza un teléfono a formato internacional (+5491123456789). null si está vacío o no es válido. */
export function normalizePhone(input: string, timezone: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  const full = trimmed.startsWith("+") ? digits : `${COUNTRY_CODE[timezone] ?? ""}${digits.replace(/^0+/, "")}`;
  return /^[1-9]\d{6,14}$/.test(full) ? `+${full}` : null;
}
