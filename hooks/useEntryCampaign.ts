import { useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';

export type CampaignStep =
  | { id: number; type: 'gift'; sortOrder: number; gift: { id: number; title: string; description: string | null; icon: string; type: string; data: any } }
  | { id: number; type: 'poll'; sortOrder: number; poll: { id: number; question: string; options: string[] } }
  | { id: number; type: 'announcement'; sortOrder: number; announcement: { id: number; title: string; content: string; excerpt?: string | null; coverImage?: string | null; category: string } }
  | { id: number; type: 'custom'; sortOrder: number; custom: { title: string; body: string; icon: string; imageUrl?: string | null; ctaLabel: string } };

export type ActiveCampaign = {
  id: number;
  title: string;
  description?: string | null;
  steps: CampaignStep[];
};

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

export function useEntryCampaign() {
  const [campaign, setCampaign] = useState<ActiveCampaign | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchActiveCampaign = useCallback(async (): Promise<ActiveCampaign | null> => {
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return null;
      const res = await fetch(`${API_URL}/api/campaigns/active`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data?.id || !Array.isArray(data.steps) || !data.steps.length) {
        setCampaign(null);
        return null;
      }
      const parsed = data as ActiveCampaign;
      setCampaign(parsed);
      return parsed;
    } catch (e) {
      console.log('fetchActiveCampaign error:', e);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const completeCampaign = useCallback(async (campaignId: number) => {
    try {
      const token = await getToken();
      if (!token) return false;
      const res = await fetch(`${API_URL}/api/campaigns/${campaignId}/complete`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return false;
      setCampaign(null);
      return true;
    } catch (e) {
      console.log('completeCampaign error:', e);
      return false;
    }
  }, []);

  const claimCampaignGift = useCallback(async (giftId: number) => {
    try {
      const token = await getToken();
      if (!token) return false;
      const res = await fetch(`${API_URL}/api/gifts/${giftId}/claim`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  const voteCampaignPoll = useCallback(async (pollId: number, optionIdx: number) => {
    try {
      const token = await getToken();
      if (!token) return false;
      const res = await fetch(`${API_URL}/api/polls/${pollId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ optionIdx }),
      });
      if (res.ok) await AsyncStorage.setItem(`poll_voted_${pollId}`, '1');
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  return {
    campaign,
    loading,
    fetchActiveCampaign,
    completeCampaign,
    claimCampaignGift,
    voteCampaignPoll,
  };
}
