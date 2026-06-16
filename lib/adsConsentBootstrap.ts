import { Platform } from 'react-native';
import mobileAds, {
  AdsConsent,
  AdsConsentDebugGeography,
  AdsConsentStatus,
} from 'react-native-google-mobile-ads';

let bootstrapPromise: Promise<void> | null = null;
let sdkInitialized = false;

export function isAdsMobileSdkInitialized(): boolean {
  return sdkInitialized;
}

/** Czeka na zakończenie UMP + initialize (nie blokuje UI — wołaj fire-and-forget). */
export function bootstrapAdsWithConsent(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = runAdsConsentBootstrap();
  }
  return bootstrapPromise;
}

async function runAdsConsentBootstrap(): Promise<void> {
  if (Platform.OS === 'web') {
    sdkInitialized = true;
    return;
  }

  await requestAndShowConsentForm();
  await initializeMobileAdsSafely();
}

/**
 * UMP: odśwież status zgody i pokaż formularz Google, gdy wymagany (RODO / EOG).
 * Błędy są łapane — aplikacja działa dalej (reklamy niespersonalizowane po stronie AdMob).
 */
async function requestAndShowConsentForm(): Promise<void> {
  try {
    const debugEea = __DEV__ && process.env.EXPO_PUBLIC_ADS_CONSENT_DEBUG_EEA === '1';
    const consentInfo = await AdsConsent.requestInfoUpdate(
      debugEea
        ? { debugGeography: AdsConsentDebugGeography.EEA }
        : undefined,
    );

    const shouldShowForm =
      consentInfo.isConsentFormAvailable
      && (
        consentInfo.status === AdsConsentStatus.UNKNOWN
        || consentInfo.status === AdsConsentStatus.REQUIRED
      );

    if (!shouldShowForm) return;

    try {
      await AdsConsent.showForm();
    } catch (formError) {
      console.warn('[AdsConsent] showForm failed — continuing without blocking app:', formError);
    }
  } catch (consentError) {
    console.warn('[AdsConsent] requestInfoUpdate failed — continuing without blocking app:', consentError);
  }
}

/** Inicjalizacja SDK po UMP; przy błędzie nadal próbujemy (UMP może użyć stanu z poprzedniej sesji). */
async function initializeMobileAdsSafely(): Promise<void> {
  if (sdkInitialized) return;

  try {
    await mobileAds().initialize();
    sdkInitialized = true;
  } catch (initError) {
    console.warn('[Ads] mobileAds().initialize() failed:', initError);
  }
}

/** Opcje żądania reklamy zgodne z wyborem użytkownika w CMP (fallback: niespersonalizowane). */
export async function getAdMobRequestOptions(): Promise<{ requestNonPersonalizedAdsOnly: boolean }> {
  if (Platform.OS === 'web') {
    return { requestNonPersonalizedAdsOnly: true };
  }
  try {
    const choices = await AdsConsent.getUserChoices();
    if (choices.selectPersonalisedAds === true) {
      return { requestNonPersonalizedAdsOnly: false };
    }
    return { requestNonPersonalizedAdsOnly: true };
  } catch {
    return { requestNonPersonalizedAdsOnly: true };
  }
}
