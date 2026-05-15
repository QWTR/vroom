import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { API_URL } from '../constants/config';

export type UgcTargetType = 'post' | 'post_comment' | 'chat_message' | 'club_message' | 'user';

export const BLOCKED_IDS_KEY = 'blockedUserIds';

async function getToken(): Promise<string | null> {
  return (
    (await AsyncStorage.getItem('userToken')) ??
    (await AsyncStorage.getItem('token'))
  );
}

export async function loadBlockedUserIds(): Promise<number[]> {
  try {
    const raw = await AsyncStorage.getItem(BLOCKED_IDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : [];
  } catch {
    return [];
  }
}

export async function saveBlockedUserIds(ids: number[]) {
  await AsyncStorage.setItem(BLOCKED_IDS_KEY, JSON.stringify(ids));
}

export async function syncBlockedUserIdsFromServer(): Promise<number[]> {
  const token = await getToken();
  if (!token) return loadBlockedUserIds();
  try {
    const res = await fetch(`${API_URL}/api/moderation/blocks`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return loadBlockedUserIds();
    const data = await res.json();
    const ids = Array.isArray(data.blockedUserIds) ? data.blockedUserIds : [];
    await saveBlockedUserIds(ids);
    return ids;
  } catch {
    return loadBlockedUserIds();
  }
}

const REPORT_REASONS = [
  { key: 'spam_vulgar', label: 'Spam / treść wulgarna' },
  { key: 'harassment', label: 'Nękanie / groźby' },
  { key: 'illegal', label: 'Treść niezgodna z prawem' },
  { key: 'other', label: 'Inne' },
] as const;

export function showReportContentAlert(
  onReport: (reason: string) => void,
  title = 'Zgłoś treść',
) {
  Alert.alert(
    title,
    'Zgłoszenie zostanie przekazane do zespołu VROOM. Rozpatrzymy je w ciągu 24 godzin.',
    [
      { text: 'Anuluj', style: 'cancel' },
      ...REPORT_REASONS.map((r) => ({
        text: r.label,
        onPress: () => onReport(r.key),
      })),
    ],
  );
}

export async function reportContent(params: {
  targetType: UgcTargetType;
  targetId: string | number;
  reason: string;
  offenderUserId?: number;
  details?: string;
}) {
  const token = await getToken();
  if (!token) {
    Toast.show({ type: 'error', text1: 'Zaloguj się', text2: 'Wymagane konto do zgłoszenia.' });
    return false;
  }
  try {
    const res = await fetch(`${API_URL}/api/moderation/report`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetType: params.targetType,
        targetId: String(params.targetId),
        reason: params.reason,
        offenderUserId: params.offenderUserId,
        details: params.details,
      }),
    });
    if (!res.ok) throw new Error();
    Toast.show({
      type: 'success',
      text1: 'Zgłoszenie wysłane',
      text2: 'Dziękujemy — rozpatrzymy sprawę w ciągu 24 h.',
    });
    return true;
  } catch {
    Toast.show({ type: 'error', text1: 'Błąd', text2: 'Nie udało się wysłać zgłoszenia.' });
    return false;
  }
}

export function showBlockUserAlert(
  userId: number,
  username: string,
  onBlocked?: (blockedIds: number[]) => void,
) {
  Alert.alert(
    'Zablokuj użytkownika',
    `Treści @${username} znikną z Twojego feedu i czatów. Zespół VROOM zostanie powiadomiony.`,
    [
      { text: 'Anuluj', style: 'cancel' },
      {
        text: 'Zablokuj',
        style: 'destructive',
        onPress: () => {
          void blockUser(userId, username).then((ids) => {
            if (ids && onBlocked) onBlocked(ids);
          });
        },
      },
    ],
  );
}

export async function blockUser(
  userId: number,
  username?: string,
): Promise<number[] | null> {
  const token = await getToken();
  if (!token) {
    Toast.show({ type: 'error', text1: 'Zaloguj się' });
    return null;
  }
  try {
    const res = await fetch(`${API_URL}/api/moderation/block/${userId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reason: 'block_user',
        details: username ? `Zablokowano @${username}` : undefined,
      }),
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    const ids = Array.isArray(data.blockedUserIds) ? data.blockedUserIds : [];
    await saveBlockedUserIds(ids);
    Toast.show({ type: 'success', text1: 'Użytkownik zablokowany' });
    return ids;
  } catch {
    Toast.show({ type: 'error', text1: 'Błąd', text2: 'Nie udało się zablokować.' });
    return null;
  }
}

export async function acceptUgcTerms(): Promise<boolean> {
  const token = await getToken();
  if (!token) return false;
  try {
    const res = await fetch(`${API_URL}/api/moderation/accept-terms`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}
