import React, {
  createContext, useContext, useState, useEffect, useCallback,
} from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { API_URL } from '../constants/config';
import { syncRevenueCatLoginFromStorage } from '../lib/revenueCatUserSync';
import { isRevenueCatSdkReady, markRevenueCatSdkReady } from '../lib/revenueCatSdkState';
import { resolveBackendPremium } from '../lib/resolveBackendPremium';
import {
  IOS_PREMIUM_ASC_REFERENCE,
  IOS_PREMIUM_SUBSCRIPTION_IDS,
  isIosPremiumProductId,
} from '../constants/iapProducts';
import {
  fetchIosPremiumProducts,
  getIosStoreKitDiagnostics,
  isIosStoreKitAvailable,
  purchaseExpirationMs,
  purchaseIosPremium,
  restoreIosPremiumPurchase,
} from '../lib/iosStoreKitPremium';
import type { PremiumBillingPeriod, PremiumProduct } from '../types/premiumProduct';

export type { PremiumProduct } from '../types/premiumProduct';

export type PremiumPurchaseResult = {
  ok: boolean;
  error?: string | null;
  cancelled?: boolean;
};

// ─── RevenueCat (require jak w Expo / web — brak modułu nie wywali bundlera) ───
// Dokumentacja: configure per platform + getCustomerInfo + entitlements.active
let Purchases: any;
let RevenueCatLogLevel: typeof import('react-native-purchases').LOG_LEVEL | undefined;
try {
  const rc = require('react-native-purchases');
  Purchases = rc.default;
  RevenueCatLogLevel = rc.LOG_LEVEL;
} catch {}

// ─── Types ────────────────────────────────────────────────────────────────────
export type CustomerInfo = any;
export type PurchasesPackage = any;
export type PurchasesOfferings = any;
export interface PremiumStatus {
  plan: string | null;
  status: string;
  currentPeriodEnd: string | null;
  premiumExpiresAt: string | null;
  source: 'unknown' | 'backend' | 'backend+rc';
  error?: string | null;
}

function hasPremiumEntitlement(info: any): boolean {
  const active = info?.entitlements?.active ?? {};
  return !!(active?.premium || active?.['vroom Premium'] || active?.['Vroom Premium']);
}

/** Play Billing / RC: subskrypcja już aktywna — traktuj jak restore, nie jako twardy błąd. */
function isAlreadyOwnedPurchaseError(error: unknown): boolean {
  const msg = String((error as Error)?.message ?? error ?? '').toLowerCase();
  const code = String((error as any)?.code ?? (error as any)?.userInfo?.code ?? '').toLowerCase();
  return (
    msg.includes('already')
    || msg.includes('item_already_owned')
    || msg.includes('itemalreadyowned')
    || msg.includes('product_already_purchased')
    || msg.includes('product already')
    || msg.includes('already active')
    || msg.includes('already owned')
    || code.includes('already')
    || code.includes('item_already_owned')
    || code.includes('product_already_purchased')
  );
}

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function syncPremiumWithBackendRetries(
  token: string,
  opts: { customerInfo?: CustomerInfo | null; productId?: string | null; expiresAtMs?: number | null } = {},
  attempts = 3,
): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    const ok = await syncPremiumWithBackend(token, opts);
    if (ok) return true;
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  return false;
}

/** Najpóźniejsza data wygaśnięcia entitlementu (ms) — do /api/premium/sync gdy webhook nie dotarł. */
function getPremiumExpirationMs(info: any): number | null {
  const active = info?.entitlements?.active ?? {};
  let best: number | null = null;
  for (const ent of Object.values(active) as any[]) {
    if (!ent || typeof ent !== 'object') continue;
    const raw = ent.expirationDate ?? ent.expiresDate ?? null;
    if (raw == null) return Date.now() + 365 * 24 * 60 * 60 * 1000;
    const ms = new Date(raw).getTime();
    if (!Number.isFinite(ms) || ms <= Date.now()) continue;
    if (best == null || ms > best) best = ms;
  }
  return best;
}

async function syncPremiumWithBackend(
  token: string,
  opts: { customerInfo?: CustomerInfo | null; productId?: string | null; expiresAtMs?: number | null } = {},
): Promise<boolean> {
  const body: Record<string, unknown> = {};
  const { customerInfo = null, productId = null, expiresAtMs = null } = opts;

  const expFromRc = customerInfo ? getPremiumExpirationMs(customerInfo) : null;
  const expMs = expiresAtMs ?? expFromRc;
  if (expMs) body.expiresAtMs = expMs;

  if (productId) {
    body.productId = productId;
  } else {
    const activeEnt = customerInfo?.entitlements?.active ?? {};
    const ent = activeEnt.premium ?? activeEnt['vroom Premium'] ?? activeEnt['Vroom Premium'];
    if (ent?.productIdentifier) body.productId = ent.productIdentifier;
  }

  try {
    const res = await fetch(`${API_URL}/api/premium/sync`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return !!data?.isPremium;
  } catch {
    return false;
  }
}

function packagesFromOfferings(offerings: PurchasesOfferings | null): any[] {
  if (!offerings) return [];
  const cur = offerings.current;
  if (Array.isArray(cur?.availablePackages) && cur.availablePackages.length > 0) {
    return cur.availablePackages;
  }
  const all = offerings.all;
  if (all && typeof all === 'object') {
    for (const id of Object.keys(all)) {
      const pkgs = all[id]?.availablePackages;
      if (Array.isArray(pkgs) && pkgs.length > 0) return pkgs;
    }
  }
  return [];
}

function inferBillingPeriodFromPackage(pkg: any): PremiumBillingPeriod {
  const type = String(pkg?.packageType ?? '').toUpperCase();
  if (type.includes('MONTH')) return 'month';
  if (type.includes('ANNUAL') || type.includes('YEAR')) return 'year';
  if (type.includes('WEEK')) return 'week';
  const iso = String(pkg?.product?.subscriptionPeriod ?? '');
  if (iso === 'P1M' || /month/i.test(iso)) return 'month';
  if (iso === 'P1Y' || /year/i.test(iso)) return 'year';
  const productId = String(pkg?.product?.identifier ?? pkg?.identifier ?? '').toLowerCase();
  if (productId.includes('year')) return 'year';
  if (productId.includes('month') || productId === 'vroom_premium') return 'month';
  return 'unknown';
}

function offeringsToPremiumProducts(offerings: PurchasesOfferings | null): PremiumProduct[] {
  return packagesFromOfferings(offerings).map((pkg) => ({
    identifier: String(pkg.identifier ?? pkg.product?.identifier ?? 'premium'),
    title: pkg.product?.title ?? 'VROOM Premium',
    priceString: pkg.product?.priceString ?? '—',
    billingPeriod: inferBillingPeriodFromPackage(pkg),
    native: pkg,
    source: 'revenuecat' as const,
  }));
}

function isRcPackage(native: unknown): boolean {
  return native != null && typeof native === 'object' && 'packageType' in (native as object);
}

function inferBillingPeriodFromStoreProduct(sp: any): PremiumBillingPeriod {
  const iso = String(sp?.subscriptionPeriod ?? '');
  if (iso === 'P1M' || /month/i.test(iso)) return 'month';
  if (iso === 'P1Y' || /year/i.test(iso)) return 'year';
  if (iso === 'P1W' || /week/i.test(iso)) return 'week';
  return inferBillingPeriodFromPackage({ product: sp, identifier: sp?.identifier });
}

function storeProductToPremium(sp: any): PremiumProduct {
  return {
    identifier: String(sp?.identifier ?? 'vroom_premium'),
    title: sp?.title ?? 'VROOM Premium',
    priceString: sp?.priceString ?? '—',
    billingPeriod: inferBillingPeriodFromStoreProduct(sp),
    native: sp,
    source: 'revenuecat_direct',
  };
}

/** Pobiera SKU bez offerings (StoreKit przez RC) — tylko diagnostyka. */
async function fetchRcDirectStoreProducts(): Promise<PremiumProduct[]> {
  if (!Purchases || !isRevenueCatSdkReady()) return [];
  try {
    const category = Purchases.PRODUCT_CATEGORY?.SUBSCRIPTION;
    const products = await Purchases.getProducts(
      [...IOS_PREMIUM_SUBSCRIPTION_IDS],
      category,
    );
    if (!Array.isArray(products) || products.length === 0) return [];
    return products.map(storeProductToPremium);
  } catch {
    return [];
  }
}

interface PremiumContextType {
  isPremium:           boolean;
  isLoading:           boolean;
  customerInfo:        CustomerInfo | null;
  premiumStatus:       PremiumStatus;
  purchasePremium:     (product: PremiumProduct) => Promise<PremiumPurchaseResult>;
  restorePurchases:    () => Promise<boolean>;
  getPremiumProducts:  () => Promise<PremiumProduct[]>;
  getOfferings:        () => Promise<PurchasesOfferings | null>;
  getRevenueCatDebugSnapshot: () => Promise<any>;
  refreshPremiumStatus:() => Promise<boolean>;
}

const PremiumContext = createContext<PremiumContextType>({
  isPremium:           false,
  isLoading:           true,
  customerInfo:        null,
  premiumStatus: {
    plan: null,
    status: 'inactive',
    currentPeriodEnd: null,
    premiumExpiresAt: null,
    source: 'unknown',
    error: null,
  },
  purchasePremium:     async () => ({ ok: false }),
  restorePurchases:    async () => false,
  getPremiumProducts:  async () => [],
  getOfferings:        async () => null,
  getRevenueCatDebugSnapshot: async () => ({}),
  refreshPremiumStatus:async () => false,
});

function getRevenueCatApiKeys(): { ios: string; android: string } {
  const extra =
    (Constants.expoConfig?.extra as
      | { revenueCatIosApiKey?: string; revenueCatAndroidApiKey?: string }
      | undefined) ??
    ((Constants as any).manifest?.extra as
      | { revenueCatIosApiKey?: string; revenueCatAndroidApiKey?: string }
      | undefined) ??
    ((Constants as any).manifest2?.extra?.expoClient?.extra as
      | { revenueCatIosApiKey?: string; revenueCatAndroidApiKey?: string }
      | undefined) ??
    ((Constants as any).manifest2?.extra as
      | { revenueCatIosApiKey?: string; revenueCatAndroidApiKey?: string }
      | undefined);

  const iosFromExtra = (extra?.revenueCatIosApiKey ?? '').trim();
  const androidFromExtra = (extra?.revenueCatAndroidApiKey ?? '').trim();
  const iosFromEnv = (process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? '').trim();
  const androidFromEnv = (process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? '').trim();
  // Public SDK keys (safe to ship in app); fallback for OTA/env propagation issues.
  const iosFallback = 'appl_lSSJchcEaJJBGvAnDUuyFoxLvfR';
  const androidFallback = 'goog_NzyiMtNIvOhxrHMNUNkBaKynuDU';

  return {
    ios: iosFromExtra || iosFromEnv || iosFallback,
    android: androidFromExtra || androidFromEnv || androidFallback,
  };
}

let revenueCatVerboseLogDone = false;

function attachRevenueCatDebugLogging(): void {
  if (!__DEV__ || !Purchases || revenueCatVerboseLogDone) return;
  const v = RevenueCatLogLevel?.VERBOSE;
  if (v == null || typeof Purchases.setLogLevel !== 'function') return;
  try {
    Purchases.setLogLevel(v);
    revenueCatVerboseLogDone = true;
  } catch {
    /* ignore */
  }
}

/**
 * Jednorazowe configure (wzór z docs RevenueCat / Expo):
 * iOS → klucz Apple, Android → klucz Google; wołaj przed getOfferings / purchase.
 */
function ensureRevenueCatConfigured(): void {
  if (!Purchases || isRevenueCatSdkReady()) return;
  attachRevenueCatDebugLogging();
  const { ios, android } = getRevenueCatApiKeys();
  const apiKey = Platform.OS === 'ios' ? ios : android;
  if (!apiKey) return;
  // RevenueCat throws hard in release when test store keys are used.
  // Fail closed (disable RC features) instead of crashing the whole app.
  if (!__DEV__ && apiKey.startsWith('test_')) {
    return;
  }
  try {
    Purchases.configure({ apiKey });
    markRevenueCatSdkReady();
  } catch {
    /* configure nie powiódł się */
  }
}

// ─── Provider ─────────────────────────────────────────────────────────────────
export function PremiumProvider({ children }: { children: React.ReactNode }) {
  const [isPremium,    setIsPremium]    = useState(false);
  const [isLoading,    setIsLoading]    = useState(true);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [premiumStatus, setPremiumStatus] = useState<PremiumStatus>({
    plan: null,
    status: 'inactive',
    currentPeriodEnd: null,
    premiumExpiresAt: null,
    source: 'unknown',
    error: null,
  });

  // Sprawdź premium z RevenueCat ORAZ backendu.
  // Gdy RC ma entitlement, a sync backendu opóźnia się — uznaj premium w UI (reklamy znikają od razu).
  const refreshPremiumStatus = useCallback(async (): Promise<boolean> => {
    const token =
      (await AsyncStorage.getItem('userToken')) ??
      (await AsyncStorage.getItem('token'));

    let rcPremium = false;
    let customerInfoSnapshot: CustomerInfo | null = null;

    const useRevenueCatClient = Purchases && isRevenueCatSdkReady();
    const rcPromise = useRevenueCatClient
      ? withTimeout(
          Purchases.getCustomerInfo()
            .then((info: CustomerInfo) => {
              customerInfoSnapshot = info;
              setCustomerInfo(info);
              return hasPremiumEntitlement(info);
            })
            .catch(() => false),
          8_000,
          false,
        )
      : Promise.resolve(false);

    const backendPromise = token
      ? resolveBackendPremium(token)
      : Promise.resolve(false);

    let backendPremium = false;
    try {
      [rcPremium, backendPremium] = await Promise.all([rcPromise, backendPromise]);

      if (token && rcPremium && !backendPremium) {
        backendPremium = await syncPremiumWithBackendRetries(token, { customerInfo: customerInfoSnapshot });
        if (!backendPremium) {
          backendPremium = await resolveBackendPremium(token);
        }
      }

      if (token) {
        const res = await withTimeout(
          fetch(`${API_URL}/api/premium/status`, {
            headers: { Authorization: `Bearer ${token}` },
          }).then(async (r) => (r.ok ? r.json() : null)).catch(() => null),
          8_000,
          null,
        );
        if (res) {
          if (res?.isPremium) backendPremium = true;
          setPremiumStatus({
            plan: res?.plan ?? null,
            status: res?.status ?? (backendPremium || rcPremium ? 'active' : 'inactive'),
            currentPeriodEnd: res?.currentPeriodEnd ? String(res.currentPeriodEnd) : null,
            premiumExpiresAt: res?.premiumExpiresAt ? String(res.premiumExpiresAt) : null,
            source: rcPremium ? 'backend+rc' : 'backend',
            error: null,
          });
        } else if (backendPremium || rcPremium) {
          setPremiumStatus(prev => ({
            ...prev,
            status: 'active',
            source: rcPremium ? 'backend+rc' : 'backend',
            error: null,
          }));
        }
      }
    } catch (e: any) {
      setPremiumStatus(prev => ({
        ...prev,
        source: rcPremium ? 'backend+rc' : prev.source,
        error: String(e?.message ?? e ?? 'premium_status_fetch_failed'),
      }));
    }

    const effective = !!(backendPremium || rcPremium);
    setIsPremium(effective);
    return effective;
  }, []);

  // Inicjalizacja SDK + logowanie usera
  useEffect(() => {
    (async () => {
      try {
        if (Purchases) {
          ensureRevenueCatConfigured();
          if (isRevenueCatSdkReady()) {
            await syncRevenueCatLoginFromStorage();
          }
        }

        // ZAWSZE sprawdzaj backend premium (gifty/admin), nawet jeśli RevenueCat nie działa.
        await refreshPremiumStatus();
      } catch {
      } finally {
        setIsLoading(false);
      }
    })();
  }, [refreshPremiumStatus]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        void refreshPremiumStatus();
      }
    });
    return () => sub.remove();
  }, [refreshPremiumStatus]);

  const syncRevenueCatAfterAppleIap = useCallback(async (): Promise<void> => {
    if (!Purchases || !isRevenueCatSdkReady()) return;
    try {
      if (typeof Purchases.syncPurchasesForResult === 'function') {
        await Purchases.syncPurchasesForResult();
      } else if (typeof Purchases.syncPurchases === 'function') {
        await Purchases.syncPurchases();
      }
      const info = await Purchases.getCustomerInfo();
      setCustomerInfo(info);
    } catch {
      /* opcjonalne — plan i zakup i tak z App Store */
    }
  }, []);

  const restorePurchases = useCallback(async (): Promise<boolean> => {
    const token =
      (await AsyncStorage.getItem('userToken')) ??
      (await AsyncStorage.getItem('token'));

    // iOS: najpierw Apple, potem RC.
    if (isIosStoreKitAvailable()) {
      const purchase = await restoreIosPremiumPurchase();
      if (purchase) {
        if (token) {
          await syncPremiumWithBackendRetries(token, {
            productId: purchase.productId,
            expiresAtMs: purchaseExpirationMs(purchase),
          });
        }
        await syncRevenueCatAfterAppleIap();
        const active = await refreshPremiumStatus();
        if (active) setIsPremium(true);
        return active;
      }
    }

    if (Purchases) ensureRevenueCatConfigured();
    const canUseRevenueCat = !!Purchases && isRevenueCatSdkReady();
    if (canUseRevenueCat) {
      try {
        const info: CustomerInfo = await Purchases.restorePurchases();
        setCustomerInfo(info);
        if (token && hasPremiumEntitlement(info)) {
          await syncPremiumWithBackendRetries(token, { customerInfo: info });
        }
        const active = await refreshPremiumStatus();
        const ok = active || hasPremiumEntitlement(info);
        if (ok) setIsPremium(true);
        return ok;
      } catch {
        /* RC restore failed */
      }
    }

    if (!Purchases) return refreshPremiumStatus();
    try {
      return await refreshPremiumStatus();
    } catch {
      return refreshPremiumStatus();
    }
  }, [refreshPremiumStatus, syncRevenueCatAfterAppleIap]);

  const purchasePremium = useCallback(async (product: PremiumProduct): Promise<PremiumPurchaseResult> => {
    const token =
      (await AsyncStorage.getItem('userToken')) ??
      (await AsyncStorage.getItem('token'));

    // iOS: StoreKit (Apple) albo RC purchaseStoreProduct gdy tylko RC ma cenę.
    if (Platform.OS === 'ios' && isIosPremiumProductId(product.identifier)) {
      if (product.source === 'storekit' && isIosStoreKitAvailable()) {
        const result = await purchaseIosPremium(product.identifier);
        if (!result.ok) {
          return { ok: false, error: result.error, cancelled: result.cancelled };
        }
        if (token && result.purchase) {
          await syncPremiumWithBackendRetries(token, {
            productId: result.purchase.productId,
            expiresAtMs: purchaseExpirationMs(result.purchase),
          });
        }
        await syncRevenueCatAfterAppleIap();
        void refreshPremiumStatus();
        return { ok: true };
      }

      if (
        (product.source === 'revenuecat' || product.source === 'revenuecat_direct')
        && Purchases
      ) {
        ensureRevenueCatConfigured();
        if (!isRevenueCatSdkReady()) {
          return { ok: false, error: 'RevenueCat nie skonfigurowany' };
        }
        try {
          const rcResult = await Purchases.purchaseStoreProduct(product.native);
          const info = rcResult?.customerInfo;
          setCustomerInfo(info);
          if (token && hasPremiumEntitlement(info)) {
            await syncPremiumWithBackendRetries(token, { customerInfo: info });
          }
          void refreshPremiumStatus();
          return { ok: true };
        } catch (e: unknown) {
          const msg = String((e as Error)?.message ?? e);
          if (isIosStoreKitAvailable()) {
            const sk = await purchaseIosPremium(product.identifier);
            if (sk.ok) {
              if (token && sk.purchase) {
                await syncPremiumWithBackendRetries(token, {
                  productId: sk.purchase.productId,
                  expiresAtMs: purchaseExpirationMs(sk.purchase),
                });
              }
              await syncRevenueCatAfterAppleIap();
              void refreshPremiumStatus();
              return { ok: true };
            }
            return { ok: false, error: sk.error ?? msg, cancelled: sk.cancelled };
          }
          return { ok: false, error: msg };
        }
      }

      if (isIosStoreKitAvailable()) {
        const result = await purchaseIosPremium(product.identifier);
        if (!result.ok) {
          return { ok: false, error: result.error, cancelled: result.cancelled };
        }
        if (token && result.purchase) {
          await syncPremiumWithBackendRetries(token, {
            productId: result.purchase.productId,
            expiresAtMs: purchaseExpirationMs(result.purchase),
          });
        }
        await syncRevenueCatAfterAppleIap();
        void refreshPremiumStatus();
        return { ok: true };
      }

      return {
        ok: false,
        error: 'Brak natywnego modułu płatności — zbuduj aplikację przez EAS/TestFlight.',
      };
    }

    if (!Purchases) return { ok: false, error: 'Brak modułu płatności' };
    ensureRevenueCatConfigured();
    if (!isRevenueCatSdkReady()) return { ok: false, error: 'RevenueCat nie skonfigurowany' };
    try {
      const useStoreProduct =
        product.source === 'revenuecat_direct' || !isRcPackage(product.native);
      const result = useStoreProduct
        ? await Purchases.purchaseStoreProduct(product.native)
        : await Purchases.purchasePackage(product.native);
      const info = result?.customerInfo;
      setCustomerInfo(info);
      if (token && hasPremiumEntitlement(info)) {
        await syncPremiumWithBackendRetries(token, { customerInfo: info });
      }
      const active = await refreshPremiumStatus();
      const ok = active || hasPremiumEntitlement(info);
      if (ok) setIsPremium(true);
      return ok ? { ok: true } : { ok: false, error: 'Zakup bez aktywnego premium — sprawdź konto' };
    } catch (e: unknown) {
      // Android: produkt już aktywny w Play — restore + sync zamiast błędu sklepu.
      if (isAlreadyOwnedPurchaseError(e)) {
        try {
          const restored = await restorePurchases();
          if (restored) {
            setIsPremium(true);
            return { ok: true };
          }
          const active = await refreshPremiumStatus();
          if (active) {
            setIsPremium(true);
            return { ok: true };
          }
          return {
            ok: false,
            error: 'Subskrypcja jest aktywna w sklepie, ale nie zsynchronizowała się z kontem. Spróbuj „Przywróć zakupy”.',
          };
        } catch (restoreErr: unknown) {
          return { ok: false, error: String((restoreErr as Error)?.message ?? restoreErr) };
        }
      }
      return { ok: false, error: String((e as Error)?.message ?? e) };
    }
  }, [refreshPremiumStatus, syncRevenueCatAfterAppleIap, restorePurchases]);

  const getPremiumProducts = useCallback(async (): Promise<PremiumProduct[]> => {
    // iOS: najpierw Apple; jeśli brak ceny — zapas z RC getProducts (bez offerings).
    if (Platform.OS === 'ios') {
      const skProducts = await fetchIosPremiumProducts();
      const withPrice = skProducts.filter((p) => (p.priceString ?? '—') !== '—');
      if (withPrice.length > 0) return withPrice;

      ensureRevenueCatConfigured();
      const rcProducts = await fetchRcDirectStoreProducts();
      const rcWithPrice = rcProducts.filter((p) => (p.priceString ?? '—') !== '—');
      if (rcWithPrice.length > 0) return rcWithPrice;

      if (skProducts.length > 0) return skProducts;
      return rcProducts;
    }

    const offerings = await (async (): Promise<PurchasesOfferings | null> => {
      if (!Purchases) return null;
      ensureRevenueCatConfigured();
      if (!isRevenueCatSdkReady()) return null;
      try {
        return await Purchases.getOfferings();
      } catch {
        return null;
      }
    })();
    return offeringsToPremiumProducts(offerings);
  }, []);

  const getOfferings = useCallback(async (): Promise<PurchasesOfferings | null> => {
    if (!Purchases) {
      if (__DEV__) console.warn('[RevenueCat] Brak modułu react-native-purchases (np. zły build / web).');
      return null;
    }
    ensureRevenueCatConfigured();
    try {
      return await Purchases.getOfferings();
    } catch (e) {
      if (__DEV__) console.warn('[RevenueCat] getOfferings błąd:', e);
      return null;
    }
  }, []);

  const getRevenueCatDebugSnapshot = useCallback(async (): Promise<any> => {
    const { ios, android } = getRevenueCatApiKeys();
    const selectedKey = Platform.OS === 'ios' ? ios : android;
    const snapshot: any = {
      platform: Platform.OS,
      bundleId:
        Constants.expoConfig?.ios?.bundleIdentifier
        ?? (Constants as any).manifest?.ios?.bundleIdentifier
        ?? null,
      appVersion: Constants.expoConfig?.version ?? null,
      hasPurchasesModule: !!Purchases,
      sdkReadyBefore: isRevenueCatSdkReady(),
      hasIosKey: !!ios,
      hasAndroidKey: !!android,
      selectedKeyPrefix: selectedKey ? selectedKey.slice(0, 5) : '',
      requestedSkus: [...IOS_PREMIUM_SUBSCRIPTION_IDS],
      ascReference: IOS_PREMIUM_ASC_REFERENCE,
    };

    if (Platform.OS === 'ios') {
      snapshot.storeKit = await getIosStoreKitDiagnostics();
      const skPlans = await fetchIosPremiumProducts();
      snapshot.storeKitPlanCount = skPlans.length;
    }

    if (!Purchases) return snapshot;

    ensureRevenueCatConfigured();
    snapshot.sdkReadyAfter = isRevenueCatSdkReady();

    if (Platform.OS === 'ios' && isRevenueCatSdkReady()) {
      try {
        const direct = await fetchRcDirectStoreProducts();
        snapshot.rcDirectProductCount = direct.length;
        snapshot.rcDirectProducts = direct.map((p) => ({
          id: p.identifier,
          price: p.priceString,
          source: p.source,
        }));
      } catch (e: any) {
        snapshot.rcDirectProductsError = String(e?.message ?? e);
      }
    }

    try {
      const offerings = await Purchases.getOfferings();
      snapshot.offeringsCurrentId = offerings?.current?.identifier ?? null;
      snapshot.offeringsCurrentPackageCount = offerings?.current?.availablePackages?.length ?? 0;
      snapshot.offeringsAllIds = Object.keys(offerings?.all ?? {});
      for (const id of snapshot.offeringsAllIds as string[]) {
        const off = offerings?.all?.[id];
        snapshot[`offering_${id}_packages`] = off?.availablePackages?.length ?? 0;
      }
    } catch (e: any) {
      snapshot.offeringsError = String(e?.message ?? e);
    }

    try {
      const info = await Purchases.getCustomerInfo();
      snapshot.activeEntitlements = Object.keys(info?.entitlements?.active ?? {});
      snapshot.originalAppUserId = info?.originalAppUserId ?? null;
    } catch (e: any) {
      snapshot.customerInfoError = String(e?.message ?? e);
    }

    try {
      const plans = await getPremiumProducts();
      snapshot.resolvedPlanCount = plans.length;
      snapshot.resolvedPlanSource = plans[0]?.source ?? null;
    } catch (e: any) {
      snapshot.resolvedPlansError = String(e?.message ?? e);
    }

    return snapshot;
  }, [getPremiumProducts]);

  return (
    <PremiumContext.Provider value={{
      isPremium, isLoading, customerInfo,
      premiumStatus,
      purchasePremium, restorePurchases, getPremiumProducts, getOfferings, getRevenueCatDebugSnapshot, refreshPremiumStatus,
    }}>
      {children}
    </PremiumContext.Provider>
  );
}

export const usePremium = () => useContext(PremiumContext);
