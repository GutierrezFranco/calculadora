"use client";

import { useState } from "react";
import { AmountInput } from "@/components/amount-input";

/** Inversión del mes con su moneda: la vista previa del monto sigue a la moneda elegida. */
export function SpendField({ fieldKey, label, local, initialCurrency, initialAmount }: { fieldKey: string; label: string; local: string; initialCurrency: string; initialAmount: string }) {
  const [currency, setCurrency] = useState(initialCurrency);
  return (
    <div className="text-sm">
      <span className="flex items-center justify-between gap-2">
        Inversión del mes
        {local !== "USD" && (
          <select name={`currency:${fieldKey}`} value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label={`Moneda de ${label}`} className="rounded-lg border border-line bg-white px-1 py-0.5 text-xs">
            <option value={local}>{local}</option>
            <option value="USD">US$</option>
          </select>
        )}
      </span>
      <AmountInput name={`spend:${fieldKey}`} currency={currency} defaultValue={initialAmount} />
    </div>
  );
}
