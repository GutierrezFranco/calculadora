import { ActionForm } from "@/components/action-form";
import { createStudent } from "./actions";

export function NewStudentForm() {
  return (
    <ActionForm action={createStudent} submitLabel="Crear alumno" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-sm">
        Nombre del alumno
        <input name="fullName" className="input" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Email
        <input name="email" type="email" required className="input" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Contraseña inicial
        <input name="password" type="text" minLength={8} required className="input" autoComplete="off" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Nombre del negocio
        <input name="businessName" required className="input" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Moneda local
        <input name="currency" defaultValue="ARS" maxLength={3} className="input uppercase" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Cotización (moneda local por 1 USD)
        <input name="usdRate" inputMode="decimal" placeholder="Opcional" className="input" />
      </label>
      <label className="flex flex-col gap-1 text-sm sm:col-span-2">
        Zona horaria
        <select name="timezone" defaultValue="America/Argentina/Buenos_Aires" className="input">
          <option value="America/Argentina/Buenos_Aires">Argentina</option>
          <option value="America/Santiago">Chile</option>
          <option value="America/Montevideo">Uruguay</option>
          <option value="America/Asuncion">Paraguay</option>
          <option value="America/La_Paz">Bolivia</option>
          <option value="America/Lima">Perú</option>
          <option value="America/Bogota">Colombia</option>
          <option value="America/Mexico_City">México</option>
          <option value="America/Guatemala">Guatemala</option>
          <option value="Europe/Madrid">España</option>
        </select>
      </label>
    </ActionForm>
  );
}
