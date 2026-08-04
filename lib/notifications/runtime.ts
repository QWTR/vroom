import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { AppState, Platform } from 'react-native';
import { API_URL } from '../../constants/config';
import { NotificationData } from './routing';

export const CHAT_NOTIFICATION_CATEGORY = 'chat_message';
export const CHAT_REPLY_ACTION = 'chat_reply';
export const MARK_READ_ACTION = 'mark_read';
const BACKGROUND_NOTIFICATION_TASK = 'VROOM_NOTIFICATION_RESPONSE_TASK';
const PENDING_REPLIES_KEY = 'vroom_pending_notification_replies_v1';

type PendingReply = {
  conversationId: number;
  replyToMessageId?: number;
  text: string;
  clientRequestId: string;
  notificationId?: number;
  createdAt: number;
};

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const type = String(notification.request.content.data?.type || '');
    const publishStatus = ['vroomki_publish_status', 'vroomki_published', 'vroomki_publish_failed'].includes(type);
    return {
      shouldShowAlert: publishStatus,
      shouldShowBanner: publishStatus,
      shouldShowList: publishStatus,
      shouldPlaySound: publishStatus,
      shouldSetBadge: true,
    };
  },
});

async function token(): Promise<string | null> {
  return (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
}

async function readPendingReplies(): Promise<PendingReply[]> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_REPLIES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

async function writePendingReplies(rows: PendingReply[]): Promise<void> {
  await AsyncStorage.setItem(PENDING_REPLIES_KEY, JSON.stringify(rows.slice(-20)));
}

async function enqueueReply(reply: PendingReply): Promise<void> {
  const rows = await readPendingReplies();
  if (!rows.some((row) => row.clientRequestId === reply.clientRequestId)) rows.push(reply);
  await writePendingReplies(rows);
}

type ReplyResult = 'sent' | 'retry' | 'rejected';

async function sendReply(reply: PendingReply): Promise<ReplyResult> {
  const authToken = await token();
  if (!authToken) return 'rejected';
  try {
    const response = await fetch(`${API_URL}/api/notifications/chat-reply`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(reply),
    });
    if (response.ok) return 'sent';
    return response.status >= 500 || response.status === 408 || response.status === 429 ? 'retry' : 'rejected';
  } catch { return 'retry'; }
}

export async function retryPendingNotificationReplies(): Promise<void> {
  const rows = await readPendingReplies();
  if (!rows.length) return;
  const remaining: PendingReply[] = [];
  for (const row of rows) {
    if ((await sendReply(row)) === 'retry') remaining.push(row);
  }
  await writePendingReplies(remaining);
}

export async function clearPendingNotificationReplies(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_REPLIES_KEY).catch(() => {});
}

async function markRead(data: NotificationData): Promise<void> {
  const authToken = await token();
  const notificationId = Number(data.notificationId);
  if (!authToken || !Number.isInteger(notificationId)) return;
  await fetch(`${API_URL}/api/notifications/${notificationId}/read`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${authToken}` },
  }).catch(() => {});
}

function responseData(response: Notifications.NotificationResponse): NotificationData {
  return (response.notification.request.content.data || {}) as NotificationData;
}

export async function handleNotificationAction(response: Notifications.NotificationResponse): Promise<'handled' | 'navigate'> {
  const data = responseData(response);
  if (response.actionIdentifier === MARK_READ_ACTION) {
    await markRead(data);
    return 'handled';
  }
  if (response.actionIdentifier !== CHAT_REPLY_ACTION) return 'navigate';
  const text = String(response.userText || '').trim();
  const conversationId = Number(data.conversationId);
  if (!text || !Number.isInteger(conversationId)) return 'handled';
  const reply: PendingReply = {
    conversationId,
    replyToMessageId: Number(data.replyToMessageId ?? data.messageId) || undefined,
    text,
    clientRequestId: `notification:${String(data.notificationId || 'n')}:${String(data.messageId || 'm')}`,
    notificationId: Number(data.notificationId) || undefined,
    createdAt: Date.now(),
  };
  const result = await sendReply(reply);
  if (result === 'retry') {
    await enqueueReply(reply);
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Odpowiedź czeka na wysłanie',
        body: 'Otwórz VROOM po odzyskaniu internetu.',
        data: { ...data, url: `/Community/chats/${conversationId}` },
      },
      trigger: null,
    }).catch(() => {});
  } else if (result === 'rejected') {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Nie udało się wysłać odpowiedzi',
        body: 'Otwórz rozmowę i sprawdź, czy nadal masz do niej dostęp.',
        data: { ...data, url: `/Community/chats/${conversationId}` },
      },
      trigger: null,
    }).catch(() => {});
  }
  await markRead(data);
  return 'handled';
}

export async function configureNotificationRuntime(): Promise<void> {
  if (Platform.OS === 'android') {
    await Promise.all([
      Notifications.setNotificationChannelAsync('vroom_alerts', {
        name: 'VROOM · Ważne', importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250], lightColor: '#e33835', sound: 'default',
      }),
      Notifications.setNotificationChannelAsync('vroom_messages', {
        name: 'VROOM · Wiadomości', importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 180, 120, 180], lightColor: '#e33835', sound: 'default',
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      }),
      Notifications.setNotificationChannelAsync('vroom_activity', {
        name: 'VROOM · Nowości i przypomnienia', importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 180], lightColor: '#e33835', sound: 'default',
      }),
    ]);
  }
  await Notifications.setNotificationCategoryAsync(CHAT_NOTIFICATION_CATEGORY, [
    {
      identifier: CHAT_REPLY_ACTION,
      buttonTitle: 'Odpowiedz',
      textInput: { placeholder: 'Napisz wiadomość…', submitButtonTitle: 'Wyślij' },
      options: { opensAppToForeground: false, isAuthenticationRequired: false, isDestructive: false },
    },
    {
      identifier: MARK_READ_ACTION,
      buttonTitle: 'Oznacz jako przeczytane',
      options: { opensAppToForeground: false, isAuthenticationRequired: false, isDestructive: false },
    },
  ]);
}

if (!TaskManager.isTaskDefined(BACKGROUND_NOTIFICATION_TASK)) {
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(BACKGROUND_NOTIFICATION_TASK, async ({ data, error }) => {
    if (error || !data || typeof data !== 'object' || !('actionIdentifier' in data)) return;
    await handleNotificationAction(data as Notifications.NotificationResponse);
  });
}
void Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK).catch(() => {});
void configureNotificationRuntime().catch(() => {});

AppState.addEventListener('change', (state) => {
  if (state === 'active') void retryPendingNotificationReplies();
});
