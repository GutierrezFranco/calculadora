import Link from "next/link";
import { signOut } from "@/app/login/actions";
import type { CurrentUser } from "@/lib/auth";

/** Barra superior. Con `businessId` muestra las secciones de ese negocio. */
export function AppHeader({ user, businessId }: { user: CurrentUser; businessId?: string }) {
  const links = [
    ...(user.isMentor ? [{ href: "/mentor", label: "Alumnos" }] : []),
    ...(businessId
      ? [
          { href: `/negocio/${businessId}`, label: "Dashboard" },
          { href: `/negocio/${businessId}/pipeline`, label: "Pipeline" },
          { href: `/negocio/${businessId}/cargar`, label: "Cargar" },
          { href: `/negocio/${businessId}/contactos`, label: "Contactos" },
          { href: `/negocio/${businessId}/prospeccion`, label: "Prospección" },
          { href: `/negocio/${businessId}/marketing`, label: "Marketing" },
          { href: `/negocio/${businessId}/proyeccion`, label: "Proyección" },
          { href: `/negocio/${businessId}/importar`, label: "Importar" },
          { href: `/negocio/${businessId}/configuracion`, label: "Configuración" },
        ]
      : []),
  ];
  return (
    <header className="border-b border-neutral-200 dark:border-neutral-800">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="font-semibold">
          MDM OS
        </Link>
        {/* En celular la barra de secciones se desliza de costado. */}
        <nav className="order-last -mx-4 flex w-[calc(100%+2rem)] gap-x-4 overflow-x-auto whitespace-nowrap px-4 pb-1 text-sm sm:order-none sm:mx-0 sm:w-auto sm:flex-1 sm:flex-wrap sm:px-0 sm:pb-0">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white">
              {l.label}
            </Link>
          ))}
        </nav>
        <form action={signOut} className="ml-auto flex items-center gap-3 text-sm sm:ml-0">
          <Link href="/cuenta" className="text-neutral-500 hover:underline">
            <span className="hidden sm:inline">{user.email}</span>
            <span className="sm:hidden">Cuenta</span>
          </Link>
          <button type="submit" className="text-neutral-600 underline dark:text-neutral-400">
            Salir
          </button>
        </form>
      </div>
    </header>
  );
}
