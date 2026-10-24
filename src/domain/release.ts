// Respaldo de esta entrega para builds fuera de Vercel.
// Al abrir un nuevo PR, actualizar este número (también para entregas documentales).
export const RELEASE_PR = 9;

/** Identifica el PR de ESTA compilación, sin consultar el último PR abierto. */
export function releasePr(pullRequestId?: string, commitMessage?: string): number {
  if (pullRequestId && /^[1-9]\d*$/.test(pullRequestId)) return Number(pullRequestId);
  const merged = commitMessage?.match(/^Merge pull request #(\d+)\b/m)
    ?? commitMessage?.trim().match(/\(#(\d+)\)$/);
  return merged && Number(merged[1]) > 0 ? Number(merged[1]) : RELEASE_PR;
}
