/** Números de página con elipsis: 1 … 4 5 6 … 12 */
export function pageWindow(current: number, total: number, radius = 1): (number | 'gap')[] {
  if (total <= 1) return [1];
  const pages = new Set([1, total]);
  for (let p = current - radius; p <= current + radius; p++) if (p >= 1 && p <= total) pages.add(p);
  const sorted = [...pages].sort((a, b) => a - b);
  const result: (number | 'gap')[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) result.push('gap');
    result.push(p);
  });
  return result;
}

export function usePagination(current: number, total: number) {
  return {
    pages: pageWindow(current, total),
    hasPrev: current > 1,
    hasNext: current < total,
  };
}
