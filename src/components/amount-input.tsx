"use client";

import { useState } from "react";
import { parseAmountText } from "@/domain/money";
import { formatMoney } from "@/lib/format";

/**
 * Campo de monto que muestra debajo cómo lo entendió ("= $ 70.200"), para que "70.200", "70200" y
 * "70.200,50" no generen dudas. Acepta lo mismo que el servidor (parseAmountText).
 */
export function AmountInput({
  name,
  currency,
  defaultValue = "",
  placeholder = "$",
  className = "input mt-1 w-full text-base",
}: {
  name: string;
  currency: string;
  defaultValue?: string;
  placeholder?: string;
  className?: string;
}) {
  const [text, setText] = useState(defaultValue);
  const cents = text.trim() ? parseAmountText(text) : null;
  return (
    <>
      <input name={name} inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} className={className} autoComplete="off" />
      {text.trim() !== "" && (
        <span className={`mt-1 block text-xs font-normal ${cents === null ? "text-bad" : "text-muted"}`} aria-live="polite">
          {cents === null ? "No es un número" : `= ${formatMoney({ [currency]: cents })}`}
        </span>
      )}
    </>
  );
}
