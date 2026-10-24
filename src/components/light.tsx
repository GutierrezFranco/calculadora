import { LIGHT_LABEL, type Light } from "@/domain/traffic-light";

const COLORS: Record<Light, string> = {
  verde: "bg-green-600",
  amarillo: "bg-amber-500",
  rojo: "bg-red-600",
  sin_datos: "bg-neutral-300 dark:bg-neutral-700",
  muestra_chica: "bg-neutral-300 dark:bg-neutral-700",
};

export function LightBadge({ light }: { light: Light }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-neutral-600 dark:text-neutral-400">
      <span className={`inline-block h-2 w-2 rounded-full ${COLORS[light]}`} aria-hidden />
      {LIGHT_LABEL[light]}
    </span>
  );
}

export const BAR_COLORS: Record<Light, string> = {
  verde: "bg-green-600",
  amarillo: "bg-amber-500",
  rojo: "bg-red-600",
  sin_datos: "bg-neutral-900 dark:bg-white",
  muestra_chica: "bg-neutral-900 dark:bg-white",
};
