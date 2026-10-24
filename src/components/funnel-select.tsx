import type { FunnelOption } from "@/lib/funnel-choice";

export function FunnelSelect({ options, label = "¿Por qué embudo llegó?", defaultValue = "" }: { options: FunnelOption[]; label?: string; defaultValue?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <select name="funnel" defaultValue={defaultValue} className="input">
        <option value="">No sé (Sin atribuir)</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
