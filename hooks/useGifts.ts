import { useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';

export type GiftData = {
  id:          number;
  title:       string;
  description: string | null;
  icon:        string;
  type:        string;
  data:        any;
};

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

export function useGifts() {
  const [gifts,   setGifts]   = useState<GiftData[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchAvailableGifts = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return;
      const res  = await fetch(`${API_URL}/api/gifts/available`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (Array.isArray(data)) setGifts(data);
    } catch (e) {
      console.log('fetchAvailableGifts error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const claimGift = useCallback(async (giftId: number) => {
    try {
      const token = await getToken();
      if (!token) return false;
      const res = await fetch(`${API_URL}/api/gifts/${giftId}/claim`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return false;
      setGifts(prev => prev.filter(g => g.id !== giftId));
      return true;
    } catch (e) {
      console.log('claimGift error:', e);
      return false;
    }
  }, []);

  return { gifts, loading, fetchAvailableGifts, claimGift };
}