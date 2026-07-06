import { useState, useCallback, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';

export interface OfficialMapMeet {
  id: number;
  title: string;
  locationName: string;
  lat: number;
  lng: number;
  date: string;
  coverImage: string | null;
  status: string | null;
  category: string;
  ticketPrice: number | null;
  ticketCurrency: string;
  maxParticipants: number;
  participantsCount: number;
  source: 'official_meet';
}

async function getToken(): Promise<string | null> {
  return (
    (await AsyncStorage.getItem('userToken'))
    ?? (await AsyncStorage.getItem('token'))
  );
}

export function useOfficialMapMeets() {
  const [meets, setMeets] = useState<OfficialMapMeet[]>([]);

  const fetchAll = useCallback(async () => {
    const token = await getToken();
    if (!token) return;

    const res = await fetch(`${API_URL}/api/meets/map`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    setMeets(Array.isArray(data?.meets) ? data.meets : []);
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  return { meets, refetch: fetchAll };
}
