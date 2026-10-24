import { ActionForm } from "@/components/action-form";
import { AppHeader } from "@/components/app-header";
import { getCurrentUser } from "@/lib/auth";
import { changePassword } from "./actions";

export default async function AccountPage() {
  const user = await getCurrentUser();
  return (
    <>
      <AppHeader user={user} businessId={user.isMentor ? undefined : user.businessIds[0]} />
      <main className="mx-auto w-full max-w-md px-4 py-6 sm:px-6 sm:py-10">
        <h1 className="mb-1 text-2xl font-semibold">Mi cuenta</h1>
        <p className="mb-6 text-sm text-neutral-500">{user.email}</p>
        <h2 className="mb-3 font-medium">Cambiar contraseña</h2>
        <ActionForm action={changePassword} submitLabel="Cambiar contraseña">
          <label className="flex flex-col gap-1 text-sm">
            Nueva contraseña
            <input name="password" type="password" minLength={8} autoComplete="new-password" required className="input" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Repetila
            <input name="confirm" type="password" minLength={8} autoComplete="new-password" required className="input" />
          </label>
        </ActionForm>
      </main>
    </>
  );
}
