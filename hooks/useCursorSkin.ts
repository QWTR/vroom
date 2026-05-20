import { useState, useCallback, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';

export interface CursorSkinItem {
  id: string;
  name: string;
  imageUrl: string | null;
  borderColor: string;
  requiresPremium: boolean;
  pointsCost: number | null;
  sortOrder: number;
  unlocked: boolean;
}

export interface ActiveCursorSkin {
  id: string;
  name: string;
  imageUrl: string | null;
  borderColor: string;
}

async function getToken(): Promise<string | null> {
  return (
    (await AsyncStorage.getItem('userToken'))
    ?? (await AsyncStorage.getItem('token'))
  );
}

export function useCursorSkin() {
  const [activeSkin, setActiveSkin] = useState<ActiveCursorSkin | null>(null);
  const [skins, setSkins] = useState<CursorSkinItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`${API_URL}/api/cursor-skins`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      const catalog: CursorSkinItem[] = Array.isArray(data?.skins) ? data.skins : [];
      setSkins(catalog);
      const activeId = String(data?.activeSkinId ?? 'default_arrow');
      const row = catalog.find((s) => s.id === activeId) ?? catalog[0];
      if (row) {
        setActiveSkin({
          id: row.id,
          name: row.name,
          imageUrl: row.imageUrl,
          borderColor: row.borderColor,
        });
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  const setActiveSkinId = useCallback(async (skinId: string) => {
    const token = await getToken();
    if (!token) return false;
    const res = await fetch(`${API_URL}/api/cursor-skins/active`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ skinId }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    if (data?.skin) {
      setActiveSkin(data.skin);
    }
    await load();
    return true;
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  return { activeSkin, skins, loading, reload: load, setActiveSkinId };
}
