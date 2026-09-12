import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { destroySharedSocket, ensureSharedSocket, pauseSharedSocket, subscribeSharedSocket } from '../../lib/sharedSocket';
import { usePathname, useRouter } from 'expo-router';
import Toast from 'react-native-toast-message';
import { useSettings } from '../../contexts/SettingsContext';
import { claimChatToast } from '../../lib/notifications/chatToast';
import { isMapScreenVisible } from '../../lib/mapScreenVisibility';
import { getAuthSessionState, subscribeToAuthSession } from '../../lib/authSessionState';

export function SharedSocketBootstrap() {
  const session = useSyncExternalStore(subscribeToAuthSession, getAuthSessionState, getAuthSessionState);
  const pathname = usePathname();
  const router = useRouter();
  const { settings } = useSettings();
  useEffect(() => {
    if (session.status !== 'authenticated') return;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void subscribeSharedSocket<{ conversationId: number; isMe?: boolean; message: { id: number; content: string; senderName: string } }>('chat:notification', (event) => {
      if (event.isMe || !event.message || settings.notifMessages === false || AppState.currentState !== 'active' || isMapScreenVisible()) return;
      const target = `/Community/chats/${event.conversationId}`;
      if (pathname === target || !claimChatToast(event.conversationId, event.message.id)) return;
      Toast.show({
        type: 'info',
        text1: `Wiadomość od ${event.message.senderName}`,
        text2: settings.messagePreviewEnabled === false ? 'Nowa wiadomość prywatna' : event.message.content?.slice(0, 140) || '📷 Zdjęcie',
        onPress: () => { Toast.hide(); router.push(target as any); },
      });
    }).then(cleanup => { if (disposed) cleanup(); else unsubscribe = cleanup; });
    return () => { disposed = true; unsubscribe?.(); };
  }, [pathname, router, settings.notifMessages, settings.messagePreviewEnabled, session.status]);
  useEffect(() => {
    if (session.status !== 'authenticated') return;
    if (AppState.currentState === 'active') void ensureSharedSocket();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void ensureSharedSocket();
      else pauseSharedSocket();
    });
    return () => {
      subscription.remove();
      destroySharedSocket();
    };
  }, [session.status]);
  return null;
}
