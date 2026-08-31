export function shouldStopNavigationForDropClaim(input: {
  hadNavigationTarget: boolean;
}): boolean {
  return input.hadNavigationTarget === true;
}
