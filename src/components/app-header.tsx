import Link from "next/link";
import { signOut } from "@/app/login/actions";
import type { CurrentUser } from "@/lib/auth";

/** Barra superior. Con `businessId` muestra las secciones de ese negocio; en celular, las principales van abajo. */
export function AppHeader({ user, businessId }: { user: CurrentUser; businessId?: string }) {
  const base = businessId ? `/negocio/${businessId}` : "";
  const main = businessId
    ? [
        { href: base, label: "Inicio" },
        { href: `${base}/embudos`, label: "Mis embudos" },
        { href: `${base}/pipeline`, label: "Oportunidades" },
        { href: `${base}/cargar`, label: "Registrar" },
        { href: `${base}/importar`, label: "Importar" },
      ]
    : [];
  const more = businessId
    ? [
        { href: `${base}/contactos`, label: "Contactos" },
        { href: `${base}/prospeccion`, label: "Prospección" },
        { href: `${base}/marketing`, label: "Marketing" },
        { href: `${base}/proyeccion`, label: "Objetivos y proyección" },
        { href: `${base}/configuracion`, label: "Configuración" },
      ]
    : [];
  const dark = user.isMentor;
  return (
    <>
      <header className={dark ? "bg-ink text-white" : "border-b border-line bg-white"}>
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 sm:px-6">
          <Link href="/" className="text-lg font-extrabold">
            MDM OS{dark && <span className="ml-1 text-sm font-medium opacity-75">· Mentor</span>}
          </Link>
          <nav aria-label="Secciones" className="order-last -mx-4 flex w-[calc(100%+2rem)] gap-1 overflow-x-auto whitespace-nowrap px-4 pb-1 text-sm sm:order-none sm:mx-0 sm:w-auto sm:flex-1 sm:flex-wrap sm:px-0 sm:pb-0">
            {user.isMentor && (
              <Link href="/mentor" className={`rounded-full px-3 py-2 font-semibold ${dark ? "text-white hover:bg-white/10" : ""}`}>
                Resumen MDM
              </Link>
            )}
            {user.isMentor && businessId && (
              <Link href={`/mentor/alumno/${businessId}`} className="rounded-full px-3 py-2 font-medium text-white/85 hover:bg-white/10">
                Ficha del alumno
              </Link>
            )}
            {main.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-full px-3 py-2 font-medium ${dark ? "text-white/85 hover:bg-white/10" : "text-[#47433D] hover:bg-soft"}`}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          {more.length > 0 && (
            <details className="relative order-1 shrink-0 text-sm sm:order-none">
              <summary className={`cursor-pointer list-none rounded-full px-3 py-2 font-medium ${dark ? "text-white/85 hover:bg-white/10" : "text-[#47433D] hover:bg-soft"}`}>
                Más ▾
              </summary>
              <div className="absolute right-0 z-50 mt-2 flex min-w-56 flex-col rounded-2xl border border-line bg-white p-2 text-ink shadow-lg">
                {more.map((l) => (
                  <Link key={l.href} href={l.href} className="rounded-xl px-3 py-2 hover:bg-soft">
                    {l.label}
                  </Link>
                ))}
              </div>
            </details>
          )}
          <form action={signOut} className="ml-auto flex items-center gap-3 text-sm sm:ml-0">
            <Link href="/cuenta" className={dark ? "text-white/75 hover:underline" : "text-muted hover:underline"}>
              <span className="hidden sm:inline">{user.email}</span>
              <span className="sm:hidden">Cuenta</span>
            </Link>
            <button type="submit" className="underline opacity-80">
              Salir
            </button>
          </form>
        </div>
      </header>
      {businessId && (
        <nav aria-label="Navegación" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-white px-2 pb-3 pt-2 sm:hidden">
          {main.slice(0, 4).map((l) => (
            <Link key={l.href} href={l.href} className="py-2 text-center text-xs font-semibold text-[#47433D]">
              {l.label === "Mis embudos" ? "Embudos" : l.label}
            </Link>
          ))}
        </nav>
      )}
    </>
  );
}
