/**
 * GPS tick / snap pipeline orchestration.
 *
 * The main `onLocation` handler and `applyTripPosition` remain in map.tsx
 * because they share 80+ refs with MapScreenInner. This module holds the
 * ref-bag contract for a future extraction once hooks stabilize.
 */
export type { MapScreenRefs } from './mapScreenRefs';
