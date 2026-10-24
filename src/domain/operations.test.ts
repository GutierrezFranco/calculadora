import { describe, expect, it } from "vitest";
import { computeMetrics } from "./metrics";
import { computeFunnelReport } from "./funnels";
import { operationPaid, paymentLabel, validLocalDate, type Operation } from "./operations";
import type { BusinessData } from "./types";
const month = { from: "2026-09-01", to: "2026-09-30" };
function fixture(): BusinessData {
 return { business: { id:"b", name:"Ficticio", currency:"ARS", timezone:"America/Argentina/Buenos_Aires", usdRate:null, depositsRefundable:false },
  opportunities: [{ id:"q", businessId:"b", contactId:"c", createdAt:"2026-09-01T15:00:00Z", stage:"nueva_consulta", source:"desconocido", lostAt:null }],
  sales:[], payments:[], adjustments:[], tallies:[], operations:[] };
}
function operation(id: string): Operation {
 return { id,contactId:"c",opportunityId:"q",occurredAt:"2026-09-20T15:00:00Z",kind:"reparacion",description:id,brand:null,model:null,reference:null,
  commercialStatus:"ganada",workStatus:"pendiente",agreedAmount:10000,currency:"ARS",directCost:3000,paymentKnown:true,funnelId:null,version:1 };
}
describe("V1.4 operaciones", () => {
 it("una consulta, un cliente, dos trabajos; cobros y saldos no se repiten", () => {
  const d=fixture();d.operations=[operation("one"),operation("two")];
  d.sales=d.operations.map((o)=>({id:"s"+o.id,businessId:"b",contactId:"c",operationId:o.id,opportunityId:"q",amount:{amount:10000,currency:"ARS"},directCost:{amount:3000,currency:"ARS"},variableCosts:null,wonAt:o.occurredAt!,status:"vigente",usdRate:null}));
  d.payments=[{id:"p",businessId:"b",operationId:"one",saleId:"sone",opportunityId:"q",amount:{amount:5000,currency:"ARS"},kind:"anticipo",paidAt:"2026-09-20T15:00:00Z",refundsPaymentId:null,usdRate:null}];
  const m=computeMetrics(d,month);
  expect(m.clientes).toBe(1);expect(m.ventasGanadas).toBe(2);expect(m.consultasCalificadas).toBe(1);
  expect(m.tasaCierre?.ganadas).toBe(1);expect(m.facturacionPactada).toEqual({ARS:20000});
  expect(m.saldoPendiente).toEqual({ARS:15000});expect(operationPaid(d.operations[1],d)).toBe(0);
  expect(computeFunnelReport(d,month).totals).toMatchObject({ventas:2,clientesUnicos:1});
 });
 it("pendiente entregada no es ganada; sin consulta no inventa una", () => {
  const d=fixture();d.opportunities=[];d.operations=[{...operation("pending"),opportunityId:null,commercialStatus:"pendiente",workStatus:"entregado",paymentKnown:false}];
  const m=computeMetrics(d,month);expect(m.ventasGanadas).toBe(0);expect(m.consultasCalificadas).toBeNull();expect(m.cobrado).toBeNull();
 });
 it("ganada sin precio cuenta sin inventar facturación y expone lo faltante", () => {
  const d=fixture();d.operations=[{...operation("unknown"),agreedAmount:null,directCost:null,paymentKnown:false}];
  const m=computeMetrics(d,month);expect(m.ventasGanadas).toBe(1);expect(m.clientes).toBe(1);expect(m.facturacionPactada).toBeNull();expect(m.contribucion).toBeNull();expect(m.cobrado).toBeNull();expect(m.tasaCierre?.ganadas).toBe(1);expect(m.avisos.join(" ")).toContain("sin precio");
 });
 it("cobro conocido sin fecha no se inventa como caja del mes", () => {
  const d=fixture();const op=operation("one");d.operations=[op];d.payments=[{id:"p",businessId:"b",operationId:"one",opportunityId:"q",saleId:null,amount:{amount:5000,currency:"ARS"},kind:"sena",paidAt:null,refundsPaymentId:null,usdRate:null}];
  expect(operationPaid(op,d)).toBe(5000);expect(computeMetrics(d,month).cobrado).toBeNull();
 });
 it("diferencia desconocido, cero y cobrado parcial; valida fecha real", () => {
  const op=operation("one");expect(paymentLabel(op,null)).toBe("Cobro desconocido");expect(paymentLabel(op,0)).toContain("Sin cobrar");expect(paymentLabel(op,100)).toBe("Cobrado parcial");
  expect(validLocalDate("2026-02-31","2026-10-24")).toBe(false);expect(validLocalDate("2026-10-25","2026-10-24")).toBe(false);expect(validLocalDate("2026-09-10","2026-10-24")).toBe(true);
 });
});
