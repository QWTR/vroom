export const PREMIUM_NATIVE_UPDATE_MESSAGE =
  'Ta funkcja wymaga najnowszej wersji aplikacji VROOM zainstalowanej ze sklepu.';

export async function pickPremiumDocuments(options: {
  type: string | string[];
  multiple?: boolean;
  copyToCacheDirectory?: boolean;
}) {
  try {
    const documentPicker = await import('expo-document-picker');
    return await documentPicker.getDocumentAsync(options);
  } catch (error) {
    const unavailable = new Error(PREMIUM_NATIVE_UPDATE_MESSAGE);
    (unavailable as Error & { cause?: unknown }).cause = error;
    throw unavailable;
  }
}

export async function sharePremiumFile(uri: string, options: { mimeType?: string } = {}) {
  try {
    const sharing = await import('expo-sharing');
    if (!(await sharing.isAvailableAsync())) throw new Error('Udostępnianie nie jest dostępne na tym urządzeniu.');
    await sharing.shareAsync(uri, options);
  } catch (error: any) {
    if (error?.message === 'Udostępnianie nie jest dostępne na tym urządzeniu.') throw error;
    throw new Error(PREMIUM_NATIVE_UPDATE_MESSAGE);
  }
}

export type PremiumNetworkState = {
  connected: boolean;
  internetReachable: boolean | null;
  transport: 'wifi' | 'cellular' | 'unknown';
  nativeModuleAvailable: boolean;
};

export async function getPremiumNetworkState(): Promise<PremiumNetworkState> {
  try {
    const network = await import('expo-network');
    const state = await network.getNetworkStateAsync();
    const wifi = state.type === network.NetworkStateType.WIFI
      || state.type === network.NetworkStateType.ETHERNET;
    return {
      connected: state.isConnected !== false,
      internetReachable: state.isInternetReachable ?? null,
      transport: wifi ? 'wifi' : state.type === network.NetworkStateType.UNKNOWN ? 'unknown' : 'cellular',
      nativeModuleAvailable: true,
    };
  } catch {
    return {
      connected: true,
      internetReachable: null,
      transport: 'unknown',
      nativeModuleAvailable: false,
    };
  }
}
