export type PremiumBillingPeriod = 'month' | 'year' | 'week' | 'unknown';

export interface PremiumProduct {
  identifier: string;
  title: string;
  priceString: string;
  billingPeriod: PremiumBillingPeriod;
  native: unknown;
  source: 'storekit' | 'revenuecat';
}
