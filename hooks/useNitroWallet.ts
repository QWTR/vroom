import { useState, useCallback, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';

export interface NitroWallet {
  rankingPoints: number;
  spendablePoints: number;
  nitroBalance: number;
  exchangeRate: number;
  exchangeDailyRankingCap: number;
  exchange: {
    enabled: boolean;
    pointsPerNitro: number;
    stepPoints: number;
    dailyPointsCap: number;
    exchangedToday: number;
    remainingToday: number;
  };
  valuation: { nitroPerPln: number };
  ledger: { id: number; amount: number; type: string; createdAt: string }[];
}

async function getToken(): Promise<string | null> {
  return (
    (await AsyncStorage.getItem('userToken'))
    ?? (await AsyncStorage.getItem('token'))
  );
}

export function useNitroWallet() {
  const [wallet, setWallet] = useState<NitroWallet | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`${API_URL}/api/nitro/wallet`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setWallet(await res.json());
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  const exchangeRankingPoints = useCallback(async (rankingPoints: number) => {
    const token = await getToken();
    if (!token) return { ok: false as const, error: 'Brak logowania' };
    const res = await fetch(`${API_URL}/api/nitro/exchange`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ rankingPoints }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false as const, error: data?.error ?? 'Błąd wymiany', code: data?.code };
    await reload();
    return { ok: true as const, ...data };
  }, [reload]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { wallet, loading, reload, exchangeRankingPoints };
}
