import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { getCurrentUser } from "@/lib/auth";

export default async function Home() {
  const user = await getCurrentUser();
  if (user.isMentor) redirect("/mentor");
  if (user.businessIds.length > 0) redirect(`/negocio/${user.businessIds[0]}`);

  return (
    <>
      <AppHeader user={user} />
      <main className="mx-auto w-full max-w-xl px-4 py-10">
        <h1 className="mb-2 text-xl font-semibold">Tu cuenta no tiene un negocio activo</h1>
        <p className="text-neutral-500">Hablá con tu mentor para que lo active.</p>
      </main>
    </>
  );
}
