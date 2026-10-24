import Link from "next/link";
import { Dashboard, parseRange } from "@/components/dashboard";
import { Funnel } from "@/components/funnel";
import { lastNDays, localDate, previousPeriod } from "@/domain/dates";
import { computeFunnel } from "@/domain/funnel";
import { computeMetrics } from "@/domain/metrics";
import { demoData } from "@/lib/demo-data";

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const days = parseRange((await searchParams).dias);
  const today = localDate(new Date().toISOString(), "America/Argentina/Buenos_Aires");
  const data = demoData(today);
  const period = lastNDays(days, today);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
        Vista previa con <strong>datos de ejemplo ficticios</strong>.{" "}
        <Link href="/login" className="underline">
          Ingresar
        </Link>
      </div>
      <Dashboard
        title={data.business.name}
        metrics={computeMetrics(data, period)}
        previous={computeMetrics(data, previousPeriod(period))}
        currency={data.business.currency}
        days={days}
        basePath="/demo"
        after={<Funnel steps={computeFunnel(data, period)} />}
      />
    </main>
  );
}
