/** Keep backend cumulative counters distinct from rate samples (bytes/second). */
export function cumulativeTotals(snapshot: { upload_total?: number | null; download_total?: number | null }) {
  const counter = (n: number | null | undefined) => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
  return { up: counter(snapshot.upload_total), down: counter(snapshot.download_total) };
}
