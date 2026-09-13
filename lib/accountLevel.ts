export function accountLevelForXp(value: unknown, levelCost = 30): number {
  const xp = Math.max(0, Math.floor(Number(value) || 0));
  const cost = Math.max(2, Math.floor(Number(levelCost) || 30));
  return Math.max(1, Math.floor((1 + Math.sqrt(1 + (8 * xp) / cost)) / 2));
}

export function localAccountProgress(value: unknown, levelCost = 30) {
  const xp = Math.max(0, Math.floor(Number(value) || 0));
  const level = accountLevelForXp(xp, levelCost);
  const currentLevelXp = (costLevel: number) => Math.floor((levelCost * costLevel * (costLevel - 1)) / 2);
  const current = currentLevelXp(level);
  const next = currentLevelXp(level + 1);
  return {
    level,
    progress: next > current ? Math.max(0, Math.min(1, (xp - current) / (next - current))) : 0,
    xpToNextLevel: String(Math.max(0, next - xp)),
  };
}
