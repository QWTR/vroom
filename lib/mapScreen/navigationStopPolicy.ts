export type NavigationStopPolicyInput = {
  navigationStartedFromFreeDrive: boolean;
  isNavigating: boolean;
};

/**
 * Navigation is only a temporary layer over an already-running free drive.
 * Closing that layer must not finalize or reset the underlying trip.
 */
export function shouldContinueFreeDriveAfterNavigationStop(
  input: NavigationStopPolicyInput,
): boolean {
  return input.navigationStartedFromFreeDrive && input.isNavigating;
}
