"use client";

import { startTransition, useActionState } from "react";
import { signIn } from "./actions";

export function LoginForm() {
  const [error, action, pending] = useActionState(signIn, null);
  return (
    <form
      // Envío manual: si la contraseña es incorrecta, el email no se borra.
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => action(formData));
      }}
      className="flex flex-col gap-3"
    >
      <label className="flex flex-col gap-1 text-sm">
        Email
        <input name="email" type="email" autoComplete="email" required className="input" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Contraseña
        <input name="password" type="password" autoComplete="current-password" required className="input" />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={pending} className="btn-primary">
        {pending ? "Ingresando…" : "Ingresar"}
      </button>
    </form>
  );
}
