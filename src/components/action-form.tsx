"use client";

import { startTransition, useActionState, useEffect, useRef, type ReactNode } from "react";

type FormState = { ok: boolean; message: string } | null;

/**
 * Formulario con botón de envío y mensaje de resultado debajo. Si hay un error,
 * conserva lo que se escribió; solo se vacía cuando la acción sale bien.
 */
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
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      // Se envía a mano para que React no vacíe el formulario cuando la acción devuelve un error.
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => formAction(formData));
      }}
      className={className ?? "flex flex-col gap-3"}
    >
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
