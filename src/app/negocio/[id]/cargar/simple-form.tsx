"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { FunnelOption } from "@/lib/funnel-choice";
import { searchCustomers, type CustomerOption, type OperationResult } from "../operaciones/actions";
import { saveSimpleOperation } from "./actions";

type Kind = "reparacion" | "venta";

/**
 * Carga simple: cliente (nombre + WhatsApp opcional), el equipo o artículo, el trabajo, costo, precio/cobrado
 * y de dónde vino. Todo en una pantalla; la fecha (hoy) y el estado (hecho) quedan en "Más opciones".
 */
export function SimpleOperationForm({
  businessId, currency, today, funnels,
}: { businessId: string; currency: string; today: string; funnels: FunnelOption[] }) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [kind, setKind] = useState<Kind>("reparacion");
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
      <input type="hidden" name="currency" value={currency} />
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
              <input name="cost" inputMode="decimal" placeholder="$" className={big} />
            </label>
            <label className="text-sm font-semibold">
              Cobrado
              <input name="paid" inputMode="decimal" placeholder="$" className={big} />
            </label>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-semibold sm:col-span-2">
              Artículo
              <input name="description" required maxLength={500} placeholder="Ej.: funda, cargador, iPhone 12 usado" className={big} />
            </label>
            <label className="text-sm font-semibold">
              Costo
              <input name="cost" inputMode="decimal" placeholder="$" className={big} />
            </label>
            <label className="text-sm font-semibold">
              Precio
              <input name="price" inputMode="decimal" placeholder="$" className={big} />
            </label>
            <label className="text-sm font-semibold sm:col-span-2">
              Cobrado
              <input name="paid" inputMode="decimal" placeholder="$ (si cobró todo, lo mismo que el precio)" className={big} />
            </label>
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
