const EXACT_TRIP_HIDDEN_LAYERS = [
  'road-number-shield',
  'road-shield',
  'road-number',
  'road-number-label',
  'route-number',
  'route-number-shield',
  'motorway-junction',
  'motorway-shield',
  'road-label',
  'road-label-small',
  'road-label-medium',
  'road-label-large',
  'road-exit-shield',
  'road-exit',
] as const;

const TRIP_LABEL_LAYER_PATTERNS = [
  /(^|[-_])(road|route)[-_].*(number|shield|ref|label)([-_]|$)/i,
  /(^|[-_])(number|shield|ref)[-_].*(road|route)([-_]|$)/i,
  /(^|[-_])motorway[-_](junction|shield|exit)([-_]|$)/i,
  /(^|[-_])road[-_]exit([-_]|$)/i,
] as const;

export function shouldHideTripMapLabelLayer(layerId: string): boolean {
  const id = String(layerId || '').trim();
  if (!id) return false;
  if ((EXACT_TRIP_HIDDEN_LAYERS as readonly string[]).includes(id)) return true;
  return TRIP_LABEL_LAYER_PATTERNS.some((pattern) => pattern.test(id));
}

export function collectTripHiddenLayerIds(layerIds: readonly string[]): string[] {
  const out = new Set<string>();
  for (const id of EXACT_TRIP_HIDDEN_LAYERS) out.add(id);
  for (const id of layerIds) {
    if (shouldHideTripMapLabelLayer(id)) out.add(id);
  }
  return [...out];
}
