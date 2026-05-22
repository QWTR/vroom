export type PremiumBillingPeriod = 'month' | 'year' | 'week' | 'unknown';

export interface PremiumProduct {
  identifier: string;
  title: string;
  priceString: string;
  billingPeriod: PremiumBillingPeriod;
  native: unknown;
  source: 'storekit' | 'revenuecat' | 'revenuecat_direct';
  /** iOS: true gdy cena/SKU przyszły z App Store (można kupić). */
  storeReady?: boolean;
}
