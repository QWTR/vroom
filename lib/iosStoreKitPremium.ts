import { Platform } from 'react-native';
import { IOS_PREMIUM_SUBSCRIPTION_IDS } from '../constants/iapProducts';
import type { PremiumBillingPeriod, PremiumProduct } from '../types/premiumProduct';

type IapModule = typeof import('react-native-iap');
type ProductSubscription = import('react-native-iap').ProductSubscription;
type Purchase = import('react-native-iap').Purchase;

let iap: IapModule | null = null;
try {
  iap = require('react-native-iap') as IapModule;
} catch {
  iap = null;
}

let connected = false;

const PREMIUM_ID_SET = new Set<string>(IOS_PREMIUM_SUBSCRIPTION_IDS);

export function isIosStoreKitAvailable(): boolean {
  return Platform.OS === 'ios' && !!iap;
}

async function connectIosStore(): Promise<boolean> {
  if (!isIosStoreKitAvailable() || !iap) return false;
  if (connected) return true;
  try {
    await iap.initConnection();
    connected = true;
    return true;
  } catch {
    connected = false;
    return false;
  }
}

function inferBillingPeriod(productId: string): PremiumBillingPeriod {
  const id = productId.toLowerCase();
  if (id.includes('year') || id.includes('annual')) return 'year';
  if (id.includes('week')) return 'week';
  if (id.includes('month') || id === 'vroom_premium') return 'month';
  return 'unknown';
}

function mapSubscriptionProduct(product: ProductSubscription): PremiumProduct {
  return {
    identifier: product.id,
    title: product.title || product.displayName || 'VROOM Premium',
    priceString: product.displayPrice || '—',
    billingPeriod: inferBillingPeriod(product.id),
    native: product,
    source: 'storekit',
  };
}

export async function fetchIosPremiumProducts(): Promise<PremiumProduct[]> {
  if (!iap || !await connectIosStore()) return [];
  try {
    const products = await iap.fetchProducts({
      skus: [...IOS_PREMIUM_SUBSCRIPTION_IDS],
      type: 'subs',
    });
    if (!Array.isArray(products)) return [];
    return products
      .filter((p): p is ProductSubscription => p?.type === 'subs')
      .map(mapSubscriptionProduct);
  } catch {
    return [];
  }
}

export async function purchaseIosPremium(productId: string): Promise<Purchase | null> {
  if (!iap || !await connectIosStore()) return null;

  return new Promise((resolve) => {
    let errorSub: { remove(): void } | null = null;

    const cleanup = () => {
      successSub.remove();
      errorSub?.remove();
    };

    const successSub = iap!.purchaseUpdatedListener(async (purchase) => {
      if (purchase.productId !== productId) return;
      cleanup();
      try {
        await iap!.finishTransaction({ purchase, isConsumable: false });
        resolve(purchase);
      } catch {
        resolve(null);
      }
    });

    errorSub = iap!.purchaseErrorListener(() => {
      cleanup();
      resolve(null);
    });

    iap!.requestPurchase({
      request: { apple: { sku: productId } },
      type: 'subs',
    }).catch(() => {
      cleanup();
      resolve(null);
    });
  });
}

export async function restoreIosPremiumPurchase(): Promise<Purchase | null> {
  if (!iap || !await connectIosStore()) return null;
  try {
    const purchases = await iap.getAvailablePurchases({
      onlyIncludeActiveItemsIOS: true,
    });
    const active = purchases
      .filter((p) => PREMIUM_ID_SET.has(p.productId))
      .sort((a, b) => (b.transactionDate ?? 0) - (a.transactionDate ?? 0));
    return active[0] ?? null;
  } catch {
    return null;
  }
}

export function purchaseExpirationMs(purchase: Purchase | null): number | null {
  if (!purchase) return null;
  const exp = purchase.expirationDateIOS;
  if (typeof exp === 'number' && Number.isFinite(exp) && exp > Date.now()) {
    return exp;
  }
  if (purchase.productId.toLowerCase().includes('year')) {
    return Date.now() + 365 * 24 * 60 * 60 * 1000;
  }
  return Date.now() + 30 * 24 * 60 * 60 * 1000;
}
