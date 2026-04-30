import React, {
  createContext, useContext, useState, useEffect, useCallback,
} from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { API_URL } from '../constants/config';
import { syncRevenueCatLoginFromStorage } from '../lib/revenueCatUserSync';
import { isRevenueCatSdkReady, markRevenueCatSdkReady } from '../lib/revenueCatSdkState';

// ─── RevenueCat types (light stubs so TS compiles without native module) ──────
let Purchases: any;
try {
  Purchases = require('react-native-purchases').default;
} catch {}

// ─── Types ────────────────────────────────────────────────────────────────────
export type CustomerInfo = any;
export type PurchasesPackage = any;
export type PurchasesOfferings = any;

interface PremiumContextType {
  isPremium:           boolean;
  isLoading:           boolean;
  customerInfo:        CustomerInfo | null;
  purchasePremium:     (pkg: PurchasesPackage) => Promise<boolean>;
  restorePurchases:    () => Promise<boolean>;
  getOfferings:        () => Promise<PurchasesOfferings | null>;
  refreshPremiumStatus:() => Promise<void>;
}

const PremiumContext = createContext<PremiumContextType>({
  isPremium:           false,
  isLoading:           true,
  customerInfo:        null,
  purchasePremium:     async () => false,
  restorePurchases:    async () => false,
  getOfferings:        async () => null,
  refreshPremiumStatus:async () => {},
});

function getRevenueCatApiKey(): string {
  const extra = Constants.expoConfig?.extra as
    | { revenueCatIosApiKey?: string; revenueCatAndroidApiKey?: string }
    | undefined;
  const ios = (extra?.revenueCatIosApiKey ?? '').trim();
  const android = (extra?.revenueCatAndroidApiKey ?? '').trim();
  return Platform.OS === 'ios' ? ios : android;
}

// ─── Provider ─────────────────────────────────────────────────────────────────
export function PremiumProvider({ children }: { children: React.ReactNode }) {
  const [isPremium,    setIsPremium]    = useState(false);
  const [isLoading,    setIsLoading]    = useState(true);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);

  // Sprawdź premium z RevenueCat ORAZ backendu
  const refreshPremiumStatus = useCallback(async () => {
    let rcPremium = false;
    let backendPremium = false;

    // RevenueCat jest opcjonalny — jego błąd nie może wyłączać premium z backendu (gifty/admin).
    if (Purchases && isRevenueCatSdkReady()) {
      try {
        const info: CustomerInfo = await Purchases.getCustomerInfo();
        setCustomerInfo(info);
        rcPremium = !!info?.entitlements?.active?.['premium'];
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
        }
      }
    } catch {}

    setIsPremium(rcPremium || backendPremium);
  }, []);

  // Inicjalizacja SDK + logowanie usera
  useEffect(() => {
    (async () => {
      try {
        if (Purchases) {
          const apiKey = getRevenueCatApiKey();
          if (apiKey && !isRevenueCatSdkReady()) {
            try {
              Purchases.configure({ apiKey });
              markRevenueCatSdkReady();
            } catch {
              /* configure nie powiódł się — nie wołamy innych metod RC */
            }
          }
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
    if (!Purchases || !isRevenueCatSdkReady()) return false;
    try {
      const { customerInfo: info } = await Purchases.purchasePackage(pkg);
      setCustomerInfo(info);
      const premium = !!info?.entitlements?.active?.['premium'];
      setIsPremium(premium);
      if (premium) await refreshPremiumStatus();
      return premium;
    } catch {
      return false;
    }
  }, [refreshPremiumStatus]);

  const restorePurchases = useCallback(async (): Promise<boolean> => {
    if (!Purchases || !isRevenueCatSdkReady()) return false;
    try {
      const info: CustomerInfo = await Purchases.restorePurchases();
      setCustomerInfo(info);
      const premium = !!info?.entitlements?.active?.['premium'];
      setIsPremium(premium);
      if (premium) await refreshPremiumStatus();
      return premium;
    } catch {
      return false;
    }
  }, [refreshPremiumStatus]);

  const getOfferings = useCallback(async (): Promise<PurchasesOfferings | null> => {
    if (!Purchases || !isRevenueCatSdkReady()) return null;
    try {
      return await Purchases.getOfferings();
    } catch {
      return null;
    }
  }, []);

  return (
    <PremiumContext.Provider value={{
      isPremium, isLoading, customerInfo,
      purchasePremium, restorePurchases, getOfferings, refreshPremiumStatus,
    }}>
      {children}
    </PremiumContext.Provider>
  );
}

export const usePremium = () => useContext(PremiumContext);
