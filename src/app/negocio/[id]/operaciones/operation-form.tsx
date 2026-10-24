"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { COMMERCIAL_LABELS, WORK_LABELS, type Operation } from "@/domain/operations";
import { customerInquiries, saveOperation, searchCustomers, type CustomerOption, type OperationResult } from "./actions";

export interface OperationFormProps {
  businessId: string; currency: string; today: string;
  funnels: { id: string; name: string }[];
  initial?: Operation;
  initialCustomer?: CustomerOption;
  initialPaid?: number | null;
  requestId: string;
}
const units = (v: number | null | undefined) => v === null || v === undefined ? "" : String(v / 100).replace(".", ",");

export function OperationForm({ businessId, currency, today, funnels, initial, initialCustomer, initialPaid, requestId: seedRequest }: OperationFormProps) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [customer, setCustomer] = useState<CustomerOption | null>(initialCustomer ?? null);
  const [query, setQuery] = useState("");
  const [phone, setPhone] = useState("");
  const [creating, setCreating] = useState(false);
  const [matches, setMatches] = useState<CustomerOption[]>([]);
  const [searchError, setSearchError] = useState("");
  const [inquiries, setInquiries] = useState<{ id: string; need: string | null; created_at: string }[]>([]);
  const [inquiry, setInquiry] = useState(initial?.opportunityId ?? "");
  const [commercial, setCommercial] = useState(initial?.commercialStatus ?? "pendiente");
  const [result, setResult] = useState<OperationResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [requestId, setRequestId] = useState(seedRequest);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      const term = phone.trim() || query.trim();
      if (customer || term.length < 2) { setMatches([]); return; }
      searchCustomers(businessId, term).then((rows) => {
        if (active) { setMatches(rows); setSearchError(""); }
      }).catch(() => { if (active) setSearchError("No se pudo buscar. Reintentá antes de guardar."); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [businessId, query, phone, customer]);

  useEffect(() => {
    let active = true;
    if (!customer) return;
    customerInquiries(businessId, customer.id).then((rows) => { if (active) setInquiries(rows); })
      .catch(() => { if (active) setSearchError("No se pudieron leer las consultas del cliente."); });
    return () => { active = false; };
  }, [businessId, customer]);

  const select = (c: CustomerOption) => {
    setCustomer(c); setCreating(false); setPhone(""); setMatches([]); setInquiry(""); setInquiries([]);
  };
  const newEntry = () => {
    if (!form.current) return;
    // Conservar solo fecha y tipo. Cliente/consulta quedan explícitos; precio, cobro y estado se limpian.
    const date = (form.current.elements.namedItem("date") as HTMLInputElement).value;
    const kind = (form.current.elements.namedItem("kind") as HTMLSelectElement).value;
    form.current.reset();
    (form.current.elements.namedItem("date") as HTMLInputElement).value = date;
    (form.current.elements.namedItem("kind") as HTMLSelectElement).value = kind;
    setCommercial("pendiente"); setRequestId(crypto.randomUUID());
    (form.current.elements.namedItem("description") as HTMLInputElement).focus();
  };

  return (
    <form ref={form} className="flex flex-col gap-5" onSubmit={(e) => {
      e.preventDefault();
      const data = new FormData(e.currentTarget);
      const another = (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "another";
      if (!customer && (!creating || query.trim() === "")) {
        setResult({ ok: false, message: "Elegí un cliente o creá uno con nombre o referencia" }); return;
      }
      startTransition(async () => {
        try {
          const saved = await saveOperation(businessId, data); setResult(saved);
          if (saved.ok) {
            if (another) {
              // El servidor devuelve el cliente persistido, para reutilizar la ficha recién creada.
              if (!customer && saved.customer) select(saved.customer);
              newEntry(); router.refresh();
            } else router.push(`/negocio/${businessId}/operaciones/${saved.id}`);
          }
        } catch { setResult({ ok: false, message: "No se pudo guardar. Tus datos siguen acá; podés reintentar." }); }
      });
    }}>
      <input type="hidden" name="id" value={initial?.id ?? ""} />
      <input type="hidden" name="version" value={initial?.version ?? 0} />
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="currency" value={initial?.currency ?? currency} />
      <input type="hidden" name="contactId" value={customer?.id ?? ""} />
      <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4">
        <legend className="mb-2 font-bold">Cliente</legend>
        {customer ? (
          <div className="rounded-xl bg-soft p-3 text-sm">
            <p className="font-semibold">{customer.name ?? "Cliente sin nombre"}</p>
            <p className="text-muted">{customer.phones.join(" · ") || "Sin WhatsApp"}</p>
            {!initial && <button type="button" className="mt-2 text-accent underline" onClick={() => {
              setCustomer(null); setCreating(false); setQuery(""); setPhone(""); setInquiries([]); setInquiry("");
            }}>Cambiar cliente</button>}
          </div>
        ) : (
          <>
            <label className="text-sm">{creating ? "Nombre o referencia" : "Buscar cliente"}
              <input name="name" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={200}
                placeholder={creating ? "Ej.: Juan o Cliente orden 42" : "Nombre o WhatsApp"} className="input mt-1 w-full" autoComplete="off" />
            </label>
            {creating && <label className="text-sm">WhatsApp <span className="text-muted">(opcional)</span>
              <input name="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Ej.: +54 9 11…" className="input mt-1 w-full" />
            </label>}
            {matches.length > 0 && <ul aria-label="Clientes encontrados" className="max-h-52 overflow-y-auto rounded-xl border border-line">
              {matches.map((c) => <li key={c.id}><button type="button" onClick={() => select(c)} className="w-full p-3 text-left text-sm hover:bg-soft">
                <span className="block font-semibold">{c.name ?? "Sin nombre"}</span><span className="text-muted">{c.phones.join(" · ") || "Sin WhatsApp"}</span>
              </button></li>)}
            </ul>}
            {!creating && <button type="button" onClick={() => setCreating(true)} className="self-start text-sm font-semibold text-accent">+ Crear cliente</button>}
          </>
        )}
        {searchError && <p role="status" className="text-sm text-warn">{searchError}</p>}
      </fieldset>
      <fieldset disabled={pending} className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        <legend className="mb-2 font-bold">Trabajo o venta</legend>
        <label className="text-sm">Tipo
          <select name="kind" defaultValue={initial?.kind ?? "reparacion"} className="input mt-1 w-full"><option value="reparacion">Reparación</option><option value="venta">Venta</option></select>
        </label>
        <label className="text-sm">Fecha <span className="text-muted">(podés dejarla vacía)</span>
          <input name="date" type="date" max={today} defaultValue={initial ? initial.occurredAt?.slice(0, 10) ?? "" : today} className="input mt-1 w-full" />
        </label>
        <label className="text-sm sm:col-span-2">Trabajo realizado o producto
          <input name="description" required maxLength={500} defaultValue={initial?.description ?? ""} placeholder="Ej.: cambio de pantalla" className="input mt-1 w-full" />
        </label>
        <label className="text-sm">Estado comercial
          <select name="commercial" value={commercial} onChange={(e) => setCommercial(e.target.value as typeof commercial)} className="input mt-1 w-full">
            {Object.entries(COMMERCIAL_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <span className="mt-1 block text-xs text-muted">Ganada: el cliente aceptó el trabajo. Entrega y cobro se cargan aparte.</span>
        </label>
        <label className="text-sm">Precio acordado · {initial?.currency ?? currency}
          <input name="price" inputMode="decimal" defaultValue={units(initial?.agreedAmount)} placeholder="Dejá vacío si no sabés" className="input mt-1 w-full" />
        </label>
        <label className="text-sm sm:col-span-2">¿De dónde vino?
          <select name="funnel" defaultValue={initial?.funnelId ?? ""} className="input mt-1 w-full">
            <option value="">No sé / Sin atribuir</option>
            {funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
      </fieldset>
      <details className="rounded-xl border border-line p-3" open={initial ? true : undefined}>
        <summary className="cursor-pointer text-sm font-semibold">Cobros, costos y más detalles (opcional)</summary>
        <fieldset disabled={pending} className="mt-4 grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="text-sm">Cobrado total hasta ahora
            <input name="paid" inputMode="decimal" defaultValue={units(initialPaid)} placeholder="Vacío = desconocido · 0 = nada cobrado" className="input mt-1 w-full" />
          </label>
          <label className="text-sm">Fecha de este cobro
            <input name="paidDate" type="date" max={today} className="input mt-1 w-full" />
            <span className="mt-1 block text-xs text-muted">Si no la sabés, queda sin fecha; no inventamos el día del pago.</span>
          </label>
          <label className="text-sm">Costo directo conocido
            <input name="cost" inputMode="decimal" defaultValue={units(initial?.directCost)} placeholder="Opcional, sin gastos fijos" className="input mt-1 w-full" />
          </label>
          <label className="text-sm">Estado de reparación / entrega
            <select name="work" defaultValue={initial?.workStatus ?? "sin_dato"} className="input mt-1 w-full">
              {Object.entries(WORK_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="text-sm">Marca<input name="brand" maxLength={100} defaultValue={initial?.brand ?? ""} className="input mt-1 w-full" /></label>
          <label className="text-sm">Modelo<input name="model" maxLength={100} defaultValue={initial?.model ?? ""} className="input mt-1 w-full" /></label>
          <label className="text-sm">Referencia de este trabajo<input name="reference" maxLength={100} defaultValue={initial?.reference ?? ""} placeholder="N° de orden, si tenés" className="input mt-1 w-full" /></label>
          <label className="text-sm">Consulta vinculada
            <select name="inquiry" value={inquiry} disabled={!customer || !!initial} onChange={(e) => setInquiry(e.target.value)} className="input mt-1 w-full">
              <option value="">Sin consulta identificada</option>
              {inquiries.map((q) => <option key={q.id} value={q.id}>{q.need ?? "Consulta"} · {q.created_at.slice(0, 10)}</option>)}
            </select>
            {initial && <input type="hidden" name="inquiry" value={inquiry} />}
          </label>
        </fieldset>
      </details>
      {commercial === "cancelada" && <div className="rounded-xl bg-soft p-3 text-sm">
        <label>Motivo de cancelación<input name="reason" className="input mt-1 w-full" /></label>
        <label className="mt-3 flex gap-2"><input name="refund" type="checkbox" />Registrar devolución de los cobros de este trabajo</label>
      </div>}
      {result && <p role="status" className={`text-sm ${result.ok ? "text-accent" : "text-bad"}`}>{result.message}</p>}
      {result?.message.includes("ese nombre") && <label className="text-sm"><input type="checkbox" name="distinctClient" /> Confirmo que es otra persona con el mismo nombre</label>}
      {result?.message.includes("duplicada") && <label className="text-sm"><input type="checkbox" name="distinctOperation" /> Confirmo que es otro trabajo distinto</label>}
      <div className="flex flex-col gap-2 sm:flex-row">
        {!initial && <button type="submit" value="another" disabled={pending || !requestId} className="btn-primary">{pending ? "Guardando…" : "Guardar y cargar otra"}</button>}
        <button type="submit" value="view" disabled={pending || !requestId} className={initial ? "btn-primary" : "btn-secondary"}>{initial ? "Guardar cambios" : "Guardar y ver operación"}</button>
      </div>
    </form>
  );
}
