import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';

const SESSION_KEY = 'vroom_ad_session_id';

async function getAuthToken(): Promise<string | null> {
  return (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
}

export type AdPlacement = 'map_banner' | 'feed_native' | 'home_banner';

export interface SponsoredCampaign {
  id: number;
  title: string;
  body?: string | null;
  imageUrl: string;
  linkUrl?: string | null;
  ctaText?: string;
  companyName?: string;
}

export interface SponsoredAdResult {
  source: 'sponsored' | 'admob';
  campaign?: SponsoredCampaign;
}

async function getOrCreateSessionId(): Promise<string> {
  let id = await AsyncStorage.getItem(SESSION_KEY);
  if (!id) {
    id = `s_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    await AsyncStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

export function useSponsoredAd(placement: AdPlacement, enabled = true) {
  const [result, setResult] = useState<SponsoredAdResult | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAd = useCallback(async () => {
    if (!enabled) {
      setResult({ source: 'admob' });
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const sessionId = await getOrCreateSessionId();
      const token = await getAuthToken();
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(
        `${API_URL}/api/ads/serve?placement=${encodeURIComponent(placement)}&sessionId=${encodeURIComponent(sessionId)}`,
        { headers },
      );
      if (res.ok) {
        const data = await res.json();
        setResult(data?.source === 'sponsored' && data.campaign
          ? { source: 'sponsored', campaign: data.campaign }
          : { source: 'admob' });
      } else {
        setResult({ source: 'admob' });
      }
    } catch {
      setResult({ source: 'admob' });
    } finally {
      setLoading(false);
    }
  }, [placement, enabled]);

  useEffect(() => {
    fetchAd();
  }, [fetchAd]);

  const recordClick = useCallback(async (campaignId: number) => {
    try {
      const sessionId = await AsyncStorage.getItem(SESSION_KEY);
      const token = await getAuthToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      await fetch(`${API_URL}/api/ads/click`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ campaignId, sessionId }),
      });
    } catch {
      // ignore
    }
  }, []);

  return { result, loading, refetch: fetchAd, recordClick };
}
