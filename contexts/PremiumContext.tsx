import React, {
  createContext, useContext, useState, useEffect, useCallback,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';

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

const RC_API_KEY = 'test_jXMkjOLpGYojUizMZulOGpdnoRG';

// ─── Provider ─────────────────────────────────────────────────────────────────
export function PremiumProvider({ children }: { children: React.ReactNode }) {
  const [isPremium,    setIsPremium]    = useState(false);
  const [isLoading,    setIsLoading]    = useState(true);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);

  // Inicjalizacja SDK + logowanie usera
  useEffect(() => {
    (async () => {
      try {
        if (!Purchases) return;
        Purchases.configure({ apiKey: RC_API_KEY });

        const raw = await AsyncStorage.getItem('user');
        if (raw) {
          const user = JSON.parse(raw);
          const uid  = user.userId ?? user.id;
          if (uid) {
            await Purchases.logIn(String(uid)).catch(() => {});
          }
        }

        await refreshPremiumStatus();
      } catch {
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  // Sprawdź premium z RevenueCat ORAZ backendu
  const refreshPremiumStatus = useCallback(async () => {
    try {
      let rcPremium = false;

      if (Purchases) {
        const info: CustomerInfo = await Purchases.getCustomerInfo();
        setCustomerInfo(info);
        rcPremium = !!info?.entitlements?.active?.['premium'];
      }

      // Sprawdź backend
      let backendPremium = false;
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
    } catch {
      setIsPremium(false);
    }
  }, []);

  const purchasePremium = useCallback(async (pkg: PurchasesPackage): Promise<boolean> => {
    if (!Purchases) return false;
    try {
      const { customerInfo: info } = await Purchases.purchasePackage(pkg);
      setCustomerInfo(info);
      const premium = !!info?.entitlements?.active?.['premium'];
      setIsPremium(premium);
      return premium;
    } catch {
      return false;
    }
  }, []);

  const restorePurchases = useCallback(async (): Promise<boolean> => {
    if (!Purchases) return false;
    try {
      const info: CustomerInfo = await Purchases.restorePurchases();
      setCustomerInfo(info);
      const premium = !!info?.entitlements?.active?.['premium'];
      setIsPremium(premium);
      return premium;
    } catch {
      return false;
    }
  }, []);

  const getOfferings = useCallback(async (): Promise<PurchasesOfferings | null> => {
    if (!Purchases) return null;
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
