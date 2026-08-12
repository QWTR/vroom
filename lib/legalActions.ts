import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';

export type RequiredLegalDocument = {
  key: string;
  name: string;
  currentVersion: { id: string; title: string; version: number };
};

async function token() {
  return (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
}

export async function getLegalAcceptanceStatus(): Promise<{ accepted: boolean; missing: RequiredLegalDocument[] }> {
  const authToken = await token();
  if (!authToken) return { accepted: true, missing: [] };
  try {
    const response = await fetch(`${API_URL}/api/legal/me/status?context=platform`, { headers: { Authorization: `Bearer ${authToken}` } });
    if (!response.ok) return { accepted: true, missing: [] };
    return response.json();
  } catch {
    return { accepted: true, missing: [] };
  }
}

export async function acceptRequiredLegalDocuments(versionIds: string[]) {
  const authToken = await token();
  if (!authToken) return false;
  try {
    const response = await fetch(`${API_URL}/api/legal/me/accept`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: 'platform', versionIds }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
