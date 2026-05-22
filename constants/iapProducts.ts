/**
 * Identyfikatory IAP iOS — muszą być 1:1 z App Store Connect / RevenueCat.
 *
 * W aplikacji (StoreKit) używamy WYŁĄCZNIE Product ID:
 *   vroom_premium
 *
 * NIE wpisujemy w kodzie:
 *   - Subscription Group ID (22060096) — tylko panel ASC
 *   - Apple ID produktu (6764699608) — wewnętrzne ASC, nie dla SDK
 *
 * RevenueCat (panel): produkt App Store = vroom_premium, bundle = com.lexuuw.vroom.app
 */
export const IOS_PREMIUM_SUBSCRIPTION_IDS = ['vroom_premium'] as const;

export type IosPremiumSubscriptionId = (typeof IOS_PREMIUM_SUBSCRIPTION_IDS)[number];

/** Metadane z ASC — do debugu / weryfikacji (nie wysyłane do StoreKit). */
export const IOS_PREMIUM_ASC_REFERENCE = {
  productId: 'vroom_premium',
  subscriptionGroupId: '22060096',
  appleProductNumericId: '6764699608',
  bundleId: 'com.lexuuw.vroom.app',
  referenceName: 'VROOM Premium',
  duration: '1 month',
} as const;

const IOS_PREMIUM_SET = new Set<string>(IOS_PREMIUM_SUBSCRIPTION_IDS);

export function isIosPremiumProductId(productId: string): boolean {
  return IOS_PREMIUM_SET.has(productId);
}
