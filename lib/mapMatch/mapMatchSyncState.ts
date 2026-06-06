/** App background flag for legacy Map Matching hook (Drive Core uses DriveEngine.setAppBackground). */
let appBackground = false;

export function setMapMatchAppBackground(active: boolean): void {
  appBackground = active;
}

export function isMapMatchAppBackground(): boolean {
  return appBackground;
}

export function resetMapMatchAppBackgroundForTests(): void {
  appBackground = false;
}
