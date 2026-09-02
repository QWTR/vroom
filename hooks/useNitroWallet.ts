import { useState, useCallback, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';
import { emitNitroWalletUpdate, subscribeNitroWallet } from '../lib/nitroWalletEvents';

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

function mergeWalletUpdate(current: NitroWallet | null, update: Partial<NitroWallet>): NitroWallet {
  if (current) return { ...current, ...update };
  return {
    rankingPoints: Number(update.rankingPoints ?? 0),
    spendablePoints: Number(update.spendablePoints ?? 0),
    nitroBalance: Number(update.nitroBalance ?? 0),
    exchangeRate: Number(update.exchangeRate ?? 0),
    exchangeDailyRankingCap: Number(update.exchangeDailyRankingCap ?? 0),
    exchange: update.exchange ?? {
      enabled: false,
      pointsPerNitro: 0,
      stepPoints: 0,
      dailyPointsCap: 0,
      exchangedToday: 0,
      remainingToday: 0,
    },
    valuation: update.valuation ?? { nitroPerPln: 0 },
    ledger: update.ledger ?? [],
  };
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
      if (res.ok) {
        const next = await res.json();
        setWallet(next);
        emitNitroWalletUpdate(next);
      }
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
    if (data?.wallet) {
      setWallet((current) => mergeWalletUpdate(current, data.wallet));
      emitNitroWalletUpdate(data.wallet);
    } else {
      await reload();
    }
    return { ok: true as const, ...data };
  }, [reload]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => subscribeNitroWallet((update) => {
    setWallet((current) => mergeWalletUpdate(current, update));
  }), []);

  return { wallet, loading, reload, exchangeRankingPoints };
}
