import Link from "next/link";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-10">
      <p className="text-sm font-medium uppercase tracking-wide text-neutral-500">MDM OS</p>
      <h1 className="mb-6 text-2xl font-semibold">Ingresar</h1>
      <LoginForm />
      <p className="mt-6 text-sm text-neutral-500">
        ¿No tenés cuenta? Te la crea tu mentor.{" "}
        <Link href="/demo" className="underline">
          Ver demo
        </Link>
      </p>
    </main>
  );
}
