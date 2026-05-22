/**
 * iOS Premium — App Store (react-native-iap). RC tylko jako zapas ceny/zakupu.
 */
import { Platform } from 'react-native';
import { IOS_PREMIUM_SUBSCRIPTION_IDS, isIosPremiumProductId } from '../constants/iapProducts';
import type { PremiumBillingPeriod, PremiumProduct } from '../types/premiumProduct';

type IapModule = typeof import('react-native-iap');
type ProductSubscription = import('react-native-iap').ProductSubscription;
type ProductSubscriptionIOS = import('react-native-iap').ProductSubscriptionIOS;
type Purchase = import('react-native-iap').Purchase;
type PurchaseError = import('react-native-iap').PurchaseError;

let iap: IapModule | null = null;
try {
  iap = require('react-native-iap') as IapModule;
} catch {
  iap = null;
}

let connected = false;
let listenersAttached = false;
let cachedSubscriptions: ProductSubscription[] = [];

const PREMIUM_ID_SET = new Set<string>(IOS_PREMIUM_SUBSCRIPTION_IDS);

type PendingPurchase = {
  resolve: (result: IosPurchaseResult) => void;
  productId: string;
  timeout: ReturnType<typeof setTimeout>;
};

let pendingPurchase: PendingPurchase | null = null;

export type IosPurchaseResult = {
  ok: boolean;
  purchase: Purchase | null;
  error: string | null;
  cancelled: boolean;
};

export function isIosStoreKitAvailable(): boolean {
  return Platform.OS === 'ios' && !!iap;
}

function isUserCancelled(error: PurchaseError | { code?: string; message?: string } | null): boolean {
  const code = String(error?.code ?? '').toLowerCase();
  const msg = String(error?.message ?? '').toLowerCase();
  return (
    code.includes('cancel')
    || code.includes('cancelled')
    || code === 'e_user_canceled'
    || msg.includes('cancel')
  );
}

function formatIosPrice(product: ProductSubscription): string {
  if (product.displayPrice?.trim()) return product.displayPrice.trim();
  const ios = product as ProductSubscriptionIOS;
  if (ios.introductoryPriceIOS?.trim()) return ios.introductoryPriceIOS.trim();
  if (product.price != null && product.currency) {
    try {
      return new Intl.NumberFormat('pl-PL', {
        style: 'currency',
        currency: product.currency,
      }).format(product.price);
    } catch {
      return `${product.price} ${product.currency}`;
    }
  }
  return '—';
}

function inferBillingPeriod(productId: string): PremiumBillingPeriod {
  const id = productId.toLowerCase();
  if (id.includes('year') || id.includes('annual')) return 'year';
  if (id.includes('week')) return 'week';
  if (id.includes('month') || id === 'vroom_premium') return 'month';
  return 'unknown';
}

function mapSubscriptionProduct(product: ProductSubscription): PremiumProduct {
  const priceString = formatIosPrice(product);
  return {
    identifier: product.id,
    title: product.title
      || product.displayName
      || (product as ProductSubscriptionIOS).displayNameIOS
      || 'VROOM Premium',
    priceString,
    billingPeriod: inferBillingPeriod(product.id),
    native: product,
    source: 'storekit',
    storeReady: priceString !== '—',
  };
}

function pickPremiumProducts(raw: unknown): ProductSubscription[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((p) => p && PREMIUM_ID_SET.has(String(p.id))) as ProductSubscription[];
}

/** Kilka strategii fetch — czasem `subs` zwraca 0, a `all` ma produkt. */
async function queryIosStoreSubscriptions(): Promise<ProductSubscription[]> {
  if (!iap || !await connectIosStore()) return [];

  const types: Array<'subs' | 'all' | 'in-app'> = ['subs', 'all', 'in-app'];
  let lastError: string | null = null;

  for (const type of types) {
    try {
      const raw = await iap.fetchProducts({
        skus: [...IOS_PREMIUM_SUBSCRIPTION_IDS],
        type,
      });
      const matched = pickPremiumProducts(raw);
      if (matched.length > 0) {
        cachedSubscriptions = matched;
        return matched;
      }
    } catch (e: unknown) {
      lastError = String((e as Error)?.message ?? e);
    }
  }

  if (cachedSubscriptions.length > 0) return cachedSubscriptions;
  if (lastError) {
    throw new Error(lastError);
  }
  return [];
}

function ensurePurchaseListeners(): void {
  if (!iap || listenersAttached) return;

  iap.purchaseUpdatedListener(async (purchase) => {
    if (!pendingPurchase || !PREMIUM_ID_SET.has(purchase.productId)) return;

    const { resolve, timeout } = pendingPurchase;
    pendingPurchase = null;
    clearTimeout(timeout);

    try {
      await iap!.finishTransaction({ purchase, isConsumable: false });
      resolve({ ok: true, purchase, error: null, cancelled: false });
    } catch (e: unknown) {
      resolve({
        ok: false,
        purchase: null,
        error: `finishTransaction: ${String((e as Error)?.message ?? e)}`,
        cancelled: false,
      });
    }
  });

  iap.purchaseErrorListener((error) => {
    if (!pendingPurchase) return;
    const { resolve, timeout } = pendingPurchase;
    pendingPurchase = null;
    clearTimeout(timeout);
    const cancelled = isUserCancelled(error);
    resolve({
      ok: false,
      purchase: null,
      error: cancelled ? null : (error?.message ?? 'purchase_error'),
      cancelled,
    });
  });

  listenersAttached = true;
}

async function connectIosStore(): Promise<boolean> {
  if (!isIosStoreKitAvailable() || !iap) return false;
  if (connected) {
    ensurePurchaseListeners();
    return true;
  }
  try {
    await iap.initConnection();
    connected = true;
    ensurePurchaseListeners();
    if (typeof iap.syncIOS === 'function') {
      try {
        await iap.syncIOS();
      } catch {
        /* optional */
      }
    }
    return true;
  } catch {
    connected = false;
    return false;
  }
}

export function isIosPremiumStoreReady(product: PremiumProduct): boolean {
  if (product.source === 'revenuecat' || product.source === 'revenuecat_direct') {
    return (product.priceString ?? '—') !== '—';
  }
  if (product.storeReady === true) return true;
  const native = product.native as ProductSubscription | null;
  if (!native) return false;
  return formatIosPrice(native) !== '—';
}

export type IosStoreKitDiagnostics = {
  available: boolean;
  connected: boolean;
  requestedSkus: readonly string[];
  productCount: number;
  products: Array<{ id: string; title: string; price: string; type?: string }>;
  fetchAttempts: string[];
  error: string | null;
};

export async function getIosStoreKitDiagnostics(): Promise<IosStoreKitDiagnostics> {
  const base: IosStoreKitDiagnostics = {
    available: isIosStoreKitAvailable(),
    connected: false,
    requestedSkus: IOS_PREMIUM_SUBSCRIPTION_IDS,
    productCount: 0,
    products: [],
    fetchAttempts: [],
    error: null,
  };
  if (!iap) {
    base.error = 'react-native-iap module missing (potrzebny build EAS, nie Expo Go)';
    return base;
  }
  const ok = await connectIosStore();
  base.connected = ok;
  if (!ok) {
    base.error = 'StoreKit initConnection failed';
    return base;
  }

  const types: Array<'subs' | 'all' | 'in-app'> = ['subs', 'all', 'in-app'];
  for (const type of types) {
    try {
      const raw = await iap.fetchProducts({
        skus: [...IOS_PREMIUM_SUBSCRIPTION_IDS],
        type,
      });
      const count = Array.isArray(raw) ? raw.length : 0;
      const matched = pickPremiumProducts(raw);
      base.fetchAttempts.push(`${type}: raw=${count} matched=${matched.length}`);
      if (matched.length > 0 && base.productCount === 0) {
        base.productCount = matched.length;
        base.products = matched.map((p) => ({
          id: p.id,
          title: p.title || p.displayName || '',
          price: formatIosPrice(p),
          type: p.type,
        }));
      }
    } catch (e: unknown) {
      base.fetchAttempts.push(`${type}: ERROR ${String((e as Error)?.message ?? e)}`);
    }
  }

  if (base.productCount === 0) {
    base.error =
      'App Store nie zwraca vroom_premium na tym urządzeniu. Produkcja: app musi być '
      + 'opublikowana w App Store z tą subskrypcją w wersji. TestFlight: konto testowe IAP w ASC.';
  }
  return base;
}

export async function fetchIosPremiumProducts(): Promise<PremiumProduct[]> {
  try {
    const subs = await queryIosStoreSubscriptions();
    return subs.map(mapSubscriptionProduct);
  } catch {
    return [];
  }
}

export async function purchaseIosPremium(productId: string): Promise<IosPurchaseResult> {
  if (!isIosPremiumProductId(productId)) {
    return { ok: false, purchase: null, error: 'Nieznany produkt', cancelled: false };
  }
  if (!iap || !await connectIosStore()) {
    return {
      ok: false,
      purchase: null,
      error: 'StoreKit niedostępny — zrób build EAS/TestFlight (Expo Go nie obsługuje IAP).',
      cancelled: false,
    };
  }

  try {
    await queryIosStoreSubscriptions();
  } catch {
    /* spróbuj i tak otworzyć sheet Apple */
  }

  if (pendingPurchase) {
    return { ok: false, purchase: null, error: 'Zakup już w toku', cancelled: false };
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (!pendingPurchase) return;
      pendingPurchase = null;
      resolve({
        ok: false,
        purchase: null,
        error: 'Brak odpowiedzi App Store. Sprawdź połączenie i czy aplikacja jest już w sklepie (produkcja) lub TestFlight (IAP testowe).',
        cancelled: false,
      });
    }, 120_000);

    pendingPurchase = { resolve, productId, timeout };

    iap!.requestPurchase({
      request: { apple: { sku: productId } },
      type: 'subs',
    }).catch((e: unknown) => {
      if (!pendingPurchase) return;
      clearTimeout(pendingPurchase.timeout);
      pendingPurchase = null;
      const msg = String((e as Error)?.message ?? e ?? 'requestPurchase failed');
      resolve({
        ok: false,
        purchase: null,
        error: msg.includes('SKU') || msg.includes('product')
          ? `${msg} — produkt vroom_premium niewidoczny dla App Store na tym buildzie.`
          : msg,
        cancelled: false,
      });
    });
  });
}

export async function restoreIosPremiumPurchase(): Promise<Purchase | null> {
  if (!iap || !await connectIosStore()) return null;
  try {
    if (typeof iap.syncIOS === 'function') {
      try {
        await iap.syncIOS();
      } catch {
        /* optional */
      }
    }
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
  const exp = (purchase as { expirationDateIOS?: number | null }).expirationDateIOS;
  if (typeof exp === 'number' && Number.isFinite(exp) && exp > Date.now()) {
    return exp;
  }
  if (purchase.productId.toLowerCase().includes('year')) {
    return Date.now() + 365 * 24 * 60 * 60 * 1000;
  }
  return Date.now() + 30 * 24 * 60 * 60 * 1000;
}
