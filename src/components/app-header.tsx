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
          { href: `/negocio/${businessId}/cargar`, label: "Cargar" },
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
        <nav className="flex flex-1 flex-wrap gap-x-4 gap-y-1 text-sm">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white">
              {l.label}
            </Link>
          ))}
        </nav>
        <form action={signOut} className="flex items-center gap-3 text-sm">
          <span className="hidden text-neutral-500 sm:inline">{user.email}</span>
          <button type="submit" className="text-neutral-600 underline dark:text-neutral-400">
            Salir
          </button>
        </form>
      </div>
    </header>
  );
}
