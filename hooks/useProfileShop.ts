import { useState, useCallback, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';
import type { ShopItemCategory, UserShopCosmetics, VehicleModelMeta } from '../constants/shopCosmetics';
import { emitMapVehicleChanged } from '../lib/mapVehicleEvents';

export interface CatalogItem {
  id: string;
  name: string;
  description?: string | null;
  category: ShopItemCategory;
  assetUrl: string;
  previewUrl?: string;
  assetKind?: string;
  nitroCost: number;
  tagLine?: string | null;
  metadata?: (VehicleModelMeta & Record<string, unknown>) | Record<string, unknown> | null;
  maxSupply?: number | null;
  soldCount?: number;
  soldOut?: boolean;
  available?: boolean;
  isFeatured?: boolean;
  unlocked: boolean;
  owned: boolean;
}

async function getToken(): Promise<string | null> {
  return (
    (await AsyncStorage.getItem('userToken'))
    ?? (await AsyncStorage.getItem('token'))
  );
}

/** Katalog ozdób za Nitro — nie zastępuje subskrypcji Premium. */
export function useProfileShop() {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [nitroBalance, setNitroBalance] = useState(0);
  const [rankingPoints, setRankingPoints] = useState(0);
  const [spendablePoints, setSpendablePoints] = useState(0);
  const [equippedIds, setEquippedIds] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);

  const loadCatalog = useCallback(async (cat?: ShopItemCategory) => {
    const token = await getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const q = cat ? `?category=${encodeURIComponent(cat)}` : '';
      const res = await fetch(`${API_URL}/api/shop/catalog${q}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setCatalog(Array.isArray(data?.items) ? data.items : []);
      setNitroBalance(Number(data?.nitroBalance ?? 0));
      setRankingPoints(Number(data?.rankingPoints ?? 0));
      setSpendablePoints(Number(data?.spendablePoints ?? data?.rankingPoints ?? 0));
      setEquippedIds(data?.equipped ?? {});
    } finally {
      setLoading(false);
    }
  }, []);

  const purchase = useCallback(async (itemId: string) => {
    const token = await getToken();
    if (!token) return { ok: false, error: 'Brak logowania' };
    const res = await fetch(`${API_URL}/api/shop/purchase/${encodeURIComponent(itemId)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error, code: data?.code };
    setNitroBalance(Number(data?.nitroBalance ?? 0));
    await loadCatalog();
    return {
      ok: true,
      item: data?.item,
      customOrderId: data?.customOrderId as string | undefined,
      requiresOrderForm: !!data?.requiresOrderForm,
    };
  }, [loadCatalog]);

  const equip = useCallback(async (category: ShopItemCategory, itemId: string | null) => {
    const token = await getToken();
    if (!token) return { ok: false };
    const res = await fetch(`${API_URL}/api/shop/equip`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ category, itemId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error };
    await loadCatalog();
    if (category === 'map_vehicle_3d') emitMapVehicleChanged();
    return { ok: true, equipped: data?.equipped as UserShopCosmetics };
  }, [loadCatalog]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  return {
    catalog,
    nitroBalance,
    rankingPoints,
    spendablePoints,
    equippedIds,
    loading,
    reload: loadCatalog,
    purchase,
    equip,
  };
}
