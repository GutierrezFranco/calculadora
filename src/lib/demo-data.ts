// Datos de ejemplo CLARAMENTE FICTICIOS para ver el dashboard sin base de datos.
// "Taller Demo" no es un negocio real y los contactos son inventados.
import { addDays } from "@/domain/dates";
import { money } from "@/domain/money";
import type { BusinessData, LocalDate, Opportunity, Payment, Sale } from "@/domain/types";

/** Generador pseudoaleatorio con semilla: los datos son siempre los mismos. */
function seeded(seed: number) {
  return () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
}

export function demoData(today: LocalDate): BusinessData {
  const rand = seeded(42);
  const data: BusinessData = {
    business: {
      id: "demo",
      name: "Taller Demo (ficticio)",
      timezone: "America/Argentina/Buenos_Aires",
      currency: "ARS",
      depositsRefundable: false,
    },
    opportunities: [],
    sales: [],
    payments: [],
    adjustments: [],
    tallies: [],
  };
  let n = 0;
  const id = () => `demo-${++n}`;
  const at = (date: LocalDate, hour: number) => `${date}T${String(hour).padStart(2, "0")}:00:00-03:00`;

  for (let back = 200; back >= 0; back--) {
    const date = addDays(today, -back);
    // Más consultas en los días recientes: el negocio viene mejorando.
    const growth = 1 + (200 - back) / 400;
    const consultas = Math.round((3 + rand() * 5) * growth);
    data.tallies.push({ id: id(), businessId: "demo", date, count: consultas, method: "manual" });

    const oportunidades = Math.round(consultas * 0.4);
    for (let i = 0; i < oportunidades; i++) {
      const contactId = `contacto-${Math.floor(rand() * 400)}`;
      const o: Opportunity = {
        id: id(),
        businessId: "demo",
        contactId,
        createdAt: at(date, 10 + i),
        stage: "presupuestado",
        source: rand() < 0.6 ? "organico" : "meta_ads",
        lostAt: null,
      };
      data.opportunities.push(o);

      const outcome = rand();
      const delay = Math.floor(rand() * 5);
      const decidedOn = addDays(date, delay);
      if (decidedOn > today) continue;

      if (outcome < 0.45) {
        const pesos = (25 + Math.floor(rand() * 15) * 10) * 1_000;
        const sale: Sale = {
          id: id(),
          businessId: "demo",
          opportunityId: o.id,
          contactId,
          amount: money(pesos * 100, "ARS"),
          directCost: rand() < 0.8 ? money(Math.round(pesos * 0.35) * 100, "ARS") : null,
          variableCosts: null,
          wonAt: at(decidedOn, 12),
          status: "vigente",
        };
        data.sales.push(sale);
        o.stage = back > 7 ? "ganado_completado" : "ganado_en_reparacion";
        const anticipo: Payment = {
          id: id(),
          businessId: "demo",
          opportunityId: o.id,
          saleId: sale.id,
          amount: money(pesos * 50, "ARS"),
          kind: "anticipo",
          paidAt: at(decidedOn, 12),
          refundsPaymentId: null,
        };
        data.payments.push(anticipo);
        const saldoOn = addDays(decidedOn, 3);
        if (saldoOn <= today) {
          data.payments.push({ ...anticipo, id: id(), kind: "saldo", paidAt: at(saldoOn, 17) });
        }
      } else if (outcome < 0.7) {
        o.stage = "perdido";
        o.lostAt = at(decidedOn, 18);
      } else if (outcome < 0.78) {
        o.stage = "senado";
        data.payments.push({
          id: id(),
          businessId: "demo",
          opportunityId: o.id,
          saleId: null,
          amount: money(2_000_000, "ARS"),
          kind: "sena",
          paidAt: at(decidedOn, 15),
          refundsPaymentId: null,
        });
      } else {
        o.stage = "en_seguimiento";
      }
    }
  }
  return data;
}
