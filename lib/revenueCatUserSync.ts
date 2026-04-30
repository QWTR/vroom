import AsyncStorage from '@react-native-async-storage/async-storage';
import { isRevenueCatSdkReady } from './revenueCatSdkState';

let Purchases: any = null;
try {
  Purchases = require('react-native-purchases').default;
} catch {
  Purchases = null;
}

/** Po zalogowaniu / wylogowaniu: powiąż RevenueCat z `app_user_id` (id z backendu). */
export async function syncRevenueCatLoginFromStorage(): Promise<void> {
  if (!Purchases || !isRevenueCatSdkReady()) return;
  try {
    const raw = await AsyncStorage.getItem('user');
    if (!raw) {
      await Purchases.logOut().catch(() => {});
      return;
    }
    const user = JSON.parse(raw) as { userId?: number; id?: number };
    const uid = user.userId ?? user.id;
    if (uid != null) {
      await Purchases.logIn(String(uid)).catch(() => {});
    } else {
      await Purchases.logOut().catch(() => {});
    }
  } catch {
    await Purchases.logOut().catch(() => {});
  }
}
