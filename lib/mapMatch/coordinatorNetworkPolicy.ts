import { DRIVE_CORE_V2 } from '../driveCore/featureFlags';

/** V2: coordinator network only for one-shot manual entry bootstrap. */
export function shouldCoordinatorAllowNetwork(reason: string): boolean {
  if (!DRIVE_CORE_V2) return true;
  return reason === 'MANUAL';
}
