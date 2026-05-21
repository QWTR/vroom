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
  fetchIosPremiumProducts,
  isIosStoreKitAvailable,
  purchaseExpirationMs,
  purchaseIosPremium,
  restoreIosPremiumPurchase,
} from '../lib/iosStoreKitPremium';
import type { PremiumBillingPeriod, PremiumProduct } from '../types/premiumProduct';

export type { PremiumProduct } from '../types/premiumProduct';

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

interface PremiumContextType {
  isPremium:           boolean;
  isLoading:           boolean;
  customerInfo:        CustomerInfo | null;
  premiumStatus:       PremiumStatus;
  purchasePremium:     (product: PremiumProduct) => Promise<boolean>;
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
  purchasePremium:     async () => false,
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

  return {
    ios: iosFromExtra || iosFromEnv,
    android: androidFromExtra || androidFromEnv,
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

  // Sprawdź premium z RevenueCat ORAZ backendu
  const refreshPremiumStatus = useCallback(async (): Promise<boolean> => {
    const token =
      (await AsyncStorage.getItem('userToken')) ??
      (await AsyncStorage.getItem('token'));

    let rcPremium = false;
    let customerInfoSnapshot: CustomerInfo | null = null;

    const useRevenueCatClient = Purchases && !isIosStoreKitAvailable() && isRevenueCatSdkReady();
    const rcPromise = useRevenueCatClient
      ? Purchases.getCustomerInfo()
          .then((info: CustomerInfo) => {
            customerInfoSnapshot = info;
            setCustomerInfo(info);
            return hasPremiumEntitlement(info);
          })
          .catch(() => false)
      : Promise.resolve(false);

    const backendPromise = token
      ? resolveBackendPremium(token)
      : Promise.resolve(false);

    let backendPremium = false;
    try {
      [rcPremium, backendPremium] = await Promise.all([rcPromise, backendPromise]);

      if (token && rcPremium && !backendPremium) {
        backendPremium = await syncPremiumWithBackend(token, { customerInfo: customerInfoSnapshot });
        if (!backendPremium) {
          backendPremium = await resolveBackendPremium(token);
        }
      }

      if (token) {
        const res = await fetch(`${API_URL}/api/premium/status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data?.isPremium) backendPremium = true;
          setPremiumStatus({
            plan: data?.plan ?? null,
            status: data?.status ?? (backendPremium ? 'active' : 'inactive'),
            currentPeriodEnd: data?.currentPeriodEnd ? String(data.currentPeriodEnd) : null,
            premiumExpiresAt: data?.premiumExpiresAt ? String(data.premiumExpiresAt) : null,
            source: rcPremium ? 'backend+rc' : 'backend',
            error: null,
          });
        } else if (backendPremium) {
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

    setIsPremium(backendPremium);
    return backendPremium;
  }, []);

  // Inicjalizacja SDK + logowanie usera
  useEffect(() => {
    (async () => {
      try {
        if (Purchases && !isIosStoreKitAvailable()) {
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

  const purchasePremium = useCallback(async (product: PremiumProduct): Promise<boolean> => {
    const token =
      (await AsyncStorage.getItem('userToken')) ??
      (await AsyncStorage.getItem('token'));

    if (product.source === 'storekit') {
      const purchase = await purchaseIosPremium(product.identifier);
      if (!purchase) return false;
      if (token) {
        await syncPremiumWithBackend(token, {
          productId: purchase.productId,
          expiresAtMs: purchaseExpirationMs(purchase),
        });
      }
      return refreshPremiumStatus();
    }

    if (!Purchases) return false;
    ensureRevenueCatConfigured();
    try {
      const { customerInfo: info } = await Purchases.purchasePackage(product.native);
      setCustomerInfo(info);
      if (token && hasPremiumEntitlement(info)) {
        await syncPremiumWithBackend(token, { customerInfo: info });
      }
      const active = await refreshPremiumStatus();
      return active || hasPremiumEntitlement(info);
    } catch {
      return false;
    }
  }, [refreshPremiumStatus]);

  const restorePurchases = useCallback(async (): Promise<boolean> => {
    const token =
      (await AsyncStorage.getItem('userToken')) ??
      (await AsyncStorage.getItem('token'));

    if (isIosStoreKitAvailable()) {
      const purchase = await restoreIosPremiumPurchase();
      if (purchase && token) {
        await syncPremiumWithBackend(token, {
          productId: purchase.productId,
          expiresAtMs: purchaseExpirationMs(purchase),
        });
      }
      return refreshPremiumStatus();
    }

    if (!Purchases) {
      return refreshPremiumStatus();
    }
    ensureRevenueCatConfigured();
    try {
      const info: CustomerInfo = await Purchases.restorePurchases();
      setCustomerInfo(info);
      if (token && hasPremiumEntitlement(info)) {
        await syncPremiumWithBackend(token, { customerInfo: info });
      }
      const active = await refreshPremiumStatus();
      return active || hasPremiumEntitlement(info);
    } catch {
      return refreshPremiumStatus();
    }
  }, [refreshPremiumStatus]);

  const getPremiumProducts = useCallback(async (): Promise<PremiumProduct[]> => {
    if (isIosStoreKitAvailable()) {
      return fetchIosPremiumProducts();
    }
    const offerings = await (async (): Promise<PurchasesOfferings | null> => {
      if (!Purchases) return null;
      ensureRevenueCatConfigured();
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
      hasPurchasesModule: !!Purchases,
      sdkReadyBefore: isRevenueCatSdkReady(),
      hasIosKey: !!ios,
      hasAndroidKey: !!android,
      selectedKeyPrefix: selectedKey ? selectedKey.slice(0, 5) : '',
    };

    if (!Purchases) return snapshot;

    ensureRevenueCatConfigured();
    snapshot.sdkReadyAfter = isRevenueCatSdkReady();

    try {
      const offerings = await Purchases.getOfferings();
      snapshot.offeringsCurrentId = offerings?.current?.identifier ?? null;
      snapshot.offeringsCurrentPackageCount = offerings?.current?.availablePackages?.length ?? 0;
      snapshot.offeringsAllIds = Object.keys(offerings?.all ?? {});
      snapshot.offeringsRaw = offerings;
    } catch (e: any) {
      snapshot.offeringsError = String(e?.message ?? e);
    }

    try {
      const info = await Purchases.getCustomerInfo();
      snapshot.customerInfoRaw = info;
      snapshot.activeEntitlements = Object.keys(info?.entitlements?.active ?? {});
    } catch (e: any) {
      snapshot.customerInfoError = String(e?.message ?? e);
    }

    return snapshot;
  }, []);

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
