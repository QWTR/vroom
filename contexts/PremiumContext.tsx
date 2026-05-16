import React, {
  createContext, useContext, useState, useEffect, useCallback,
} from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { API_URL } from '../constants/config';
import { syncRevenueCatLoginFromStorage } from '../lib/revenueCatUserSync';
import { isRevenueCatSdkReady, markRevenueCatSdkReady } from '../lib/revenueCatSdkState';

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

interface PremiumContextType {
  isPremium:           boolean;
  isLoading:           boolean;
  customerInfo:        CustomerInfo | null;
  premiumStatus:       PremiumStatus;
  purchasePremium:     (pkg: PurchasesPackage) => Promise<boolean>;
  restorePurchases:    () => Promise<boolean>;
  getOfferings:        () => Promise<PurchasesOfferings | null>;
  getRevenueCatDebugSnapshot: () => Promise<any>;
  refreshPremiumStatus:() => Promise<void>;
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
  getOfferings:        async () => null,
  getRevenueCatDebugSnapshot: async () => ({}),
  refreshPremiumStatus:async () => {},
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
  const refreshPremiumStatus = useCallback(async () => {
    let rcPremium = false;
    let backendPremium = false;

    // RevenueCat jest opcjonalny — jego błąd nie może wyłączać premium z backendu (gifty/admin).
    if (Purchases) {
      try {
        const info: CustomerInfo = await Purchases.getCustomerInfo();
        setCustomerInfo(info);
        rcPremium = hasPremiumEntitlement(info);
      } catch {}
    }

    // Sprawdź backend
    try {
      const token =
        (await AsyncStorage.getItem('userToken')) ??
        (await AsyncStorage.getItem('token'));
      if (token) {
        const res = await fetch(`${API_URL}/api/premium/status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          backendPremium = !!data?.isPremium;
          setPremiumStatus({
            plan: data?.plan ?? null,
            status: data?.status ?? (backendPremium ? 'active' : 'inactive'),
            currentPeriodEnd: data?.currentPeriodEnd ? String(data.currentPeriodEnd) : null,
            premiumExpiresAt: data?.premiumExpiresAt ? String(data.premiumExpiresAt) : null,
            source: rcPremium ? 'backend+rc' : 'backend',
            error: null,
          });
        }
      }
    } catch (e: any) {
      setPremiumStatus(prev => ({
        ...prev,
        source: rcPremium ? 'backend+rc' : prev.source,
        error: String(e?.message ?? e ?? 'premium_status_fetch_failed'),
      }));
    }

    setIsPremium(rcPremium || backendPremium);
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
  const purchasePremium = useCallback(async (pkg: PurchasesPackage): Promise<boolean> => {
    if (!Purchases) return false;
    ensureRevenueCatConfigured();
    try {
      const { customerInfo: info } = await Purchases.purchasePackage(pkg);
      setCustomerInfo(info);
      const premium = hasPremiumEntitlement(info);
      setIsPremium(premium);
      if (premium) await refreshPremiumStatus();
      return premium;
    } catch {
      return false;
    }
  }, [refreshPremiumStatus]);

  const restorePurchases = useCallback(async (): Promise<boolean> => {
    if (!Purchases) return false;
    ensureRevenueCatConfigured();
    try {
      const info: CustomerInfo = await Purchases.restorePurchases();
      setCustomerInfo(info);
      const premium = hasPremiumEntitlement(info);
      setIsPremium(premium);
      if (premium) await refreshPremiumStatus();
      return premium;
    } catch {
      return false;
    }
  }, [refreshPremiumStatus]);

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
      purchasePremium, restorePurchases, getOfferings, getRevenueCatDebugSnapshot, refreshPremiumStatus,
    }}>
      {children}
    </PremiumContext.Provider>
  );
}

export const usePremium = () => useContext(PremiumContext);
