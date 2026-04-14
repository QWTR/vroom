import { useEffect }      from 'react';
import * as Notifications from 'expo-notifications';
import * as Device        from 'expo-device';
import Constants          from 'expo-constants';
import { Platform }       from 'react-native';
import AsyncStorage       from '@react-native-async-storage/async-storage';
import { API_URL }        from '../constants/config';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert:  true,
    shouldPlaySound:  true,
    shouldSetBadge:   true,
    shouldShowBanner: true,
    shouldShowList:   true,
  }),
});

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

export function usePushNotifications() {
  useEffect(() => {
    registerPushToken();
  }, []);
}

export async function registerPushToken() {
  try {
    if (!Device.isDevice) return;

    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('vroom_alerts', {
        name:             'VROOM Powiadomienia',
        importance:       Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor:       '#e33835',
        sound:            'default',
      });
      await Notifications.setNotificationChannelAsync('default', {
        name:             'default',
        importance:       Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor:       '#e33835',
      });
    }

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;

    if (!projectId) {
      console.error('❌ Brak projectId w app.json!');
      return;
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    console.log('✅ Push token:', tokenData.data);

    const authToken = await getToken();
    if (!authToken) return;

    const res = await fetch(`${API_URL}/api/notifications/push-token`, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        token:    tokenData.data,
        platform: Platform.OS,
      }),
    });

    console.log('📡 Token zapisany:', res.status);
  } catch (e) {
    console.error('❌ Push token registration failed:', e);
  }
}