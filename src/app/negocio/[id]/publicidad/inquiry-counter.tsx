"use client";

import { useState, useTransition } from "react";
import { bumpInquiry } from "./actions";

/**
 * Consultas del mes con botones grandes de +1 / −1: durante un live se toca +1 por cada persona que escribe
 * (reemplaza las rayitas en un cuaderno). Cada toque se guarda al instante.
 */
export function InquiryCounter({ businessId, funnelKey, month, initial }: { businessId: string; funnelKey: string; month: string; initial: number | null }) {
  const [value, setValue] = useState(initial === null ? "" : String(initial));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const bump = (delta: 1 | -1) =>
    start(async () => {
      const r = await bumpInquiry(businessId, funnelKey, month, delta);
      if (r.ok) {
        setValue(String(r.count));
        setError(null);
      } else setError(r.message ?? "No se pudo sumar");
    });
  return (
    <div className="flex flex-col">
      <div className="mt-1 flex items-stretch gap-1">
        <button type="button" onClick={() => bump(-1)} disabled={pending || value === "" || value === "0"} aria-label="Restar una consulta" className="btn-secondary px-3 text-lg">
          −
        </button>
        <input name={`inq:${funnelKey}`} inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} placeholder="—" className="input w-full min-w-0 text-center text-base" />
        <button type="button" onClick={() => bump(1)} disabled={pending} aria-label="Sumar una consulta" className="btn-accent px-4 text-lg">
          +1
        </button>
      </div>
      {error && <span className="mt-1 text-xs text-bad">{error}</span>}
    </div>
  );
}
