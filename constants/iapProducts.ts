/** App Store Connect product IDs — muszą być 1:1 jak w ASC / RevenueCat. */
export const IOS_PREMIUM_SUBSCRIPTION_IDS = ['vroom_premium'] as const;

export type IosPremiumSubscriptionId = (typeof IOS_PREMIUM_SUBSCRIPTION_IDS)[number];
