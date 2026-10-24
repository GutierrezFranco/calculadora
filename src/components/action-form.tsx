"use client";

import { useActionState, type ReactNode } from "react";

type FormState = { ok: boolean; message: string } | null;

/** Formulario con botón de envío y mensaje de resultado debajo. */
export function ActionForm({
  action,
  submitLabel,
  className,
  children,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  className?: string;
  children: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className={className ?? "flex flex-col gap-3"}>
      {children}
      <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row sm:items-center">
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Guardando…" : submitLabel}
        </button>
        {state && (
          <p role="status" className={`text-sm ${state.ok ? "text-green-700 dark:text-green-400" : "text-red-600"}`}>
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
