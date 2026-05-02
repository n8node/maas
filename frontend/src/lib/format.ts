/** Compact token display (e.g. 7.8M, 2.2K). */
export function formatTokens(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return n.toLocaleString("en-US");
}

export function formatRub(rub: number): string {
  return `₽${rub.toLocaleString("en-US")}`;
}

export function formatKopecksAsRub(kopecks: number): string {
  return formatRub(Math.round(kopecks / 100));
}

export function pricePer1kTokens(priceRub: number, tokens: number): string {
  if (tokens <= 0) return "—";
  const perK = (priceRub / tokens) * 1000;
  return `${formatRub(Math.round(perK * 100) / 100)} / 1K`;
}

export function formatStorageGb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
