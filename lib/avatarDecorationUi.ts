export function centeredAvatarDecorationMetrics(size: number) {
  const outer = size * 1.28;
  return { outer, margin: -(outer / 2) };
}
