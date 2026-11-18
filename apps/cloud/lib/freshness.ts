/** How old a package's score is, as the Certified cards say it. */
export function freshnessLabel(days: number): string {
  if (days <= 1) return 'Updated today';
  if (days <= 7) return `Updated ${days}d ago`;
  if (days <= 30) return `Updated ${Math.floor(days / 7)}w ago`;
  if (days < 365) return `Updated ${Math.floor(days / 30)}mo ago`;
  return `Updated ${Math.floor(days / 365)}y ago`;
}
