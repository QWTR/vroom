export function formatExplorationPercent(cellsRevealed: number, percentComplete: number): string {
  const cells = Math.max(0, Number(cellsRevealed) || 0);
  const percent = Math.max(0, Number(percentComplete) || 0);
  if (cells > 0 && percent < 1) return '<1%';
  return `${Math.round(percent)}%`;
}
