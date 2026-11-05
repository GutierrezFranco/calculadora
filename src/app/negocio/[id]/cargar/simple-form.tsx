"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AmountInput } from "@/components/amount-input";
import { formatMoney } from "@/lib/format";
import type { FunnelOption } from "@/lib/funnel-choice";
import { searchCustomers, type CustomerOption, type OperationResult } from "../operaciones/actions";
import { saveSimpleOperation } from "./actions";

type Kind = "reparacion" | "venta";

export interface TradeInOption {
  id: string;
  description: string;
  /** Valor tomado, en unidades mínimas de su moneda. */
  value: number;
  currency: string;
}

/**
 * Carga simple: cliente (nombre + WhatsApp opcional), el equipo o artículo, el trabajo, costo, precio/cobrado
 * y de dónde vino. Todo en una pantalla; la fecha (hoy) y el estado (hecho) quedan en "Más opciones".
 */
export function SimpleOperationForm({
  businessId, currency, today, funnels, tradeIns = [],
}: { businessId: string; currency: string; today: string; funnels: FunnelOption[]; tradeIns?: TradeInOption[] }) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [kind, setKind] = useState<Kind>("reparacion");
  // Plan canje: equipo recibido en parte de pago (receivingTrade) o equipo de canje que se vende (soldTrade).
  const [receivingTrade, setReceivingTrade] = useState(false);
  const [soldTrade, setSoldTrade] = useState("");
  const sold = tradeIns.find((t) => t.id === soldTrade);
  // Moneda de cada tipo: las reparaciones suelen cobrarse en pesos y las ventas de equipos en dólares.
  // Se recuerda la última elegida para cada tipo en este navegador.
  const [currencyOf, setCurrencyOf] = useState<Record<Kind, string>>({ reparacion: currency, venta: currency });
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("mdm:monedas") ?? "{}") as Partial<Record<Kind, string>>;
      // Se lee después de hidratar: en el servidor no hay localStorage.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCurrencyOf((c) => ({
        reparacion: saved.reparacion === "USD" || saved.reparacion === currency ? saved.reparacion : c.reparacion,
        venta: saved.venta === "USD" || saved.venta === currency ? saved.venta : c.venta,
      }));
    } catch {}
  }, [currency]);
  const opCurrency = kind === "venta" && sold ? sold.currency : currencyOf[kind];
  const chooseCurrency = (value: string) => {
    const next = { ...currencyOf, [kind]: value };
    setCurrencyOf(next);
    try {
      localStorage.setItem("mdm:monedas", JSON.stringify(next));
    } catch {}
  };
  const [funnel, setFunnel] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [matches, setMatches] = useState<CustomerOption[]>([]);
  const [result, setResult] = useState<OperationResult | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [pending, start] = useTransition();

  // Mientras escribe el nombre o el WhatsApp, sugiere clientes que ya cargó (para no duplicarlos)
  useEffect(() => {
    let active = true;
    const term = phone.trim().length >= 4 ? phone.trim() : name.trim();
    const t = setTimeout(() => {
      if (customer || term.length < 2) return setMatches([]);
      searchCustomers(businessId, term).then((rows) => active && setMatches(rows.slice(0, 5))).catch(() => {});
    }, 250);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [businessId, name, phone, customer]);

  const reset = () => {
    form.current?.reset();
    setName("");
    setPhone("");
    setCustomer(null);
    setMatches([]);
    setReceivingTrade(false);
    setSoldTrade("");
    setRequestId(crypto.randomUUID());
    (form.current?.elements.namedItem("name") as HTMLInputElement | null)?.focus();
  };

  const submit = (extra?: Record<string, string>) => {
    if (!form.current) return;
    const data = new FormData(form.current);
    for (const [k, v] of Object.entries(extra ?? {})) data.set(k, v);
    if (!customer && !name.trim()) return setResult({ ok: false, message: "Poné el nombre del cliente" });
    start(async () => {
      try {
        const r = await saveSimpleOperation(businessId, data);
        setResult(r);
        if (r.ok) {
          const who = customer?.name ?? name.trim();
          const what = String(data.get("description") ?? "");
          setSaved((s) => [`${who} · ${what}`, ...s].slice(0, 5));
          reset();
          router.refresh();
        }
      } catch {
        setResult({ ok: false, message: "No se pudo guardar. Tus datos siguen acá: probá de nuevo." });
      }
    });
  };

  const big = "input mt-1 w-full text-base";
  const sameName = result && !result.ok && result.message.includes("ese nombre");
  const dupJob = result && !result.ok && result.message.includes("duplicada");

  return (
    <form
      ref={form}
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input type="hidden" name="id" value="" />
      <input type="hidden" name="version" value="0" />
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="currency" value={opCurrency} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="contactId" value={customer?.id ?? ""} />
      <input type="hidden" name="funnel" value={funnel} />

      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="¿Qué cargás?">
        {(["reparacion", "venta"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => setKind(k)}
            className={`rounded-xl border px-4 py-3 text-base font-bold ${kind === k ? "border-accent bg-accent text-white" : "border-line bg-white"}`}
          >
            {k === "reparacion" ? "🔧 Reparación" : "🛒 Venta"}
          </button>
        ))}
      </div>

      {currency !== "USD" && (
        <div className="flex items-center gap-2 text-sm" role="radiogroup" aria-label="Moneda">
          <span className="font-semibold">Moneda:</span>
          {[currency, "USD"].map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={opCurrency === c}
              onClick={() => chooseCurrency(c)}
              className={`rounded-full border px-3 py-1.5 font-semibold ${opCurrency === c ? "border-ink bg-ink text-white" : "border-line bg-white"}`}
            >
              {c === "USD" ? "Dólares (US$)" : `Pesos (${c})`}
            </button>
          ))}
          <span className="text-xs text-muted">Costo, precio y cobrado van en esta moneda.</span>
        </div>
      )}

      <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {customer ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-line bg-soft px-3 py-2 sm:col-span-2">
              <span className="text-sm">
                Cliente: <b>{customer.name}</b>
                {customer.phones[0] && <span className="text-muted"> · {customer.phones[0]}</span>}
              </span>
              <button type="button" className="text-sm font-semibold text-accent" onClick={() => setCustomer(null)}>
                Cambiar
              </button>
            </div>
          ) : (
            <>
              <label className="text-sm font-semibold">
                Cliente
                <input name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoComplete="off" placeholder="Nombre" className={big} />
              </label>
              <label className="text-sm font-semibold">
                WhatsApp <span className="font-normal text-muted">(opcional)</span>
                <input name="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Ej.: 351 555 1234" className={big} />
              </label>
              {matches.length > 0 && (
                <div className="sm:col-span-2">
                  <p className="text-xs text-muted">¿Es alguno de estos? Tocalo para no repetirlo:</p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {matches.map((m) => (
                      <button key={m.id} type="button" onClick={() => { setCustomer(m); setResult(null); }} className="rounded-full border border-line bg-white px-3 py-1 text-sm">
                        {m.name}
                        {m.phones[0] && <span className="text-muted"> · {m.phones[0]}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {kind === "reparacion" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-semibold">
              Equipo
              <input name="model" maxLength={100} placeholder="Ej.: iPhone 11, Samsung J7" className={big} />
            </label>
            <label className="text-sm font-semibold">
              Reparación
              <input name="description" required maxLength={500} placeholder="Ej.: cambio de módulo" className={big} />
            </label>
            <label className="text-sm font-semibold">
              Costo del repuesto
              <AmountInput key={`cost-${requestId}`} name="cost" currency={opCurrency} />
            </label>
            <label className="text-sm font-semibold">
              Cobrado
              <AmountInput key={`paid-${requestId}`} name="paid" currency={opCurrency} />
            </label>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {tradeIns.length > 0 && (
              <label className="text-sm font-semibold sm:col-span-2">
                ¿Vendés un equipo que recibiste en canje?
                <select name="soldTradeIn" value={soldTrade} onChange={(e) => setSoldTrade(e.target.value)} className={big}>
                  <option value="">No</option>
                  {tradeIns.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.description} · tomado en {formatMoney({ [t.currency]: t.value })}
                    </option>
                  ))}
                </select>
                {sold && <span className="mt-1 block text-xs font-normal text-muted">El costo es lo que valía cuando lo tomaste.</span>}
              </label>
            )}
            <label className="text-sm font-semibold sm:col-span-2">
              Artículo
              <input key={`desc-${requestId}-${soldTrade}`} name="description" required maxLength={500} defaultValue={sold?.description ?? ""} placeholder="Ej.: funda, cargador, iPhone 12 usado" className={big} />
            </label>
            <label className="text-sm font-semibold">
              Costo
              <AmountInput key={`cost-${requestId}-${soldTrade}`} name="cost" currency={opCurrency} defaultValue={sold ? String(sold.value / 100).replace(".", ",") : ""} />
            </label>
            <label className="text-sm font-semibold">
              Precio
              <AmountInput key={`price-${requestId}`} name="price" currency={opCurrency} />
            </label>
            <label className="text-sm font-semibold sm:col-span-2">
              Cobrado
              <AmountInput key={`paid-${requestId}`} name="paid" currency={opCurrency} placeholder={receivingTrade ? "$ en plata, sin contar el equipo" : "$ (si cobró todo, lo mismo que el precio)"} />
            </label>
            {receivingTrade ? (
              <div className="grid gap-3 rounded-xl border border-line bg-soft p-3 sm:col-span-2 sm:grid-cols-2">
                <p className="text-sm font-bold sm:col-span-2">Equipo que recibiste en parte de pago</p>
                <label className="text-sm font-semibold">
                  Qué equipo
                  <input name="tradeDesc" maxLength={200} placeholder="Ej.: iPhone 15 Pro Max 256 GB" className={big} />
                </label>
                <label className="text-sm font-semibold">
                  En cuánto lo tomaste
                  <AmountInput key={`trade-${requestId}`} name="tradeValue" currency={opCurrency} />
                </label>
                <p className="text-xs text-muted sm:col-span-2">
                  Poné el precio completo de la venta. El equipo cuenta como parte del pago y queda en tu lista de canjes: cuando lo vendas, elegilo arriba y el
                  costo se completa solo.
                </p>
                <button type="button" className="text-left text-xs font-semibold text-muted underline sm:col-span-2" onClick={() => setReceivingTrade(false)}>
                  Quitar el equipo
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setReceivingTrade(true)} className="text-left text-sm font-semibold text-accent sm:col-span-2">
                + Recibí un equipo en parte de pago (plan canje)
              </button>
            )}
          </div>
        )}

        <div>
          <p className="text-sm font-semibold">¿De dónde vino?</p>
          <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="¿De dónde vino?">
            {[...funnels, { value: "", label: "No sé" }].map((f) => (
              <button
                key={f.value || "nose"}
                type="button"
                role="radio"
                aria-checked={funnel === f.value}
                onClick={() => setFunnel(f.value)}
                className={`rounded-full border px-3 py-2 text-sm font-medium ${funnel === f.value ? "border-accent bg-accent text-white" : "border-line bg-white"}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <details className="text-sm">
          <summary className="cursor-pointer text-muted">Más opciones (fecha, si todavía está pendiente)</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label>
              Fecha
              <input name="date" type="date" defaultValue={today} max={today} className="input mt-1 w-full" />
            </label>
            <label>
              Estado
              <select name="commercial" defaultValue="ganada" className="input mt-1 w-full">
                <option value="ganada">Hecho / vendido</option>
                <option value="pendiente">Pendiente (todavía no lo cerré)</option>
              </select>
            </label>
          </div>
        </details>

        {result && !result.ok && (
          <div role="alert" className="rounded-xl bg-bad/10 p-3 text-sm text-bad">
            {result.message}
            {sameName && (
              <button type="button" className="mt-2 block font-semibold underline" onClick={() => submit({ distinctClient: "on" })}>
                Es otra persona con el mismo nombre: guardar igual
              </button>
            )}
            {dupJob && (
              <button type="button" className="mt-2 block font-semibold underline" onClick={() => submit({ distinctOperation: "on" })}>
                Es otro trabajo distinto: guardar igual
              </button>
            )}
          </div>
        )}

        <button type="submit" className="btn-accent w-full py-3 text-base">
          {pending ? "Guardando…" : "Guardar y cargar otra"}
        </button>
      </fieldset>

      {saved.length > 0 && (
        <div className="rounded-xl bg-good/10 p-3 text-sm">
          <p className="font-semibold text-good">✓ Guardado</p>
          <ul className="mt-1 text-muted">
            {saved.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
    </form>
  );
}
