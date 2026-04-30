/**
 * RevenueCat: native iOS/Android wymaga wywołania configure() przed jakimkolwiek
 * getCustomerInfo / logIn / purchase — inaczej może być natywny crash przy starcie.
 */
let sdkReady = false;

export function markRevenueCatSdkReady(): void {
  sdkReady = true;
}

export function isRevenueCatSdkReady(): boolean {
  return sdkReady;
}
