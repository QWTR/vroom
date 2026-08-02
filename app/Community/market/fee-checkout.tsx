import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initStripe, useStripe } from '@stripe/stripe-react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import Toast from 'react-native-toast-message';
import { API_URL } from '../../../constants/config';
import { useTheme } from '../../../contexts/ThemeContext';

type FeeQuote = {
  amount: number;
  taxAmount: number | null;
  totalAmount: number | null;
  currency: string;
};

const money = (amount: number | null | undefined, currency = 'PLN') =>
  amount == null ? '—' : `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;

const showToast = (options: Record<string, unknown>) => Toast.show(options as never);

const paramOne = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default function MarketFeeCheckoutScreen() {
  const params = useLocalSearchParams<{
    kind?: string;
    listingId?: string;
    duration?: string;
  }>();
  const kind = paramOne(params.kind) || 'listing_slot';
  const listingId = paramOne(params.listingId);
  const duration = paramOne(params.duration) === 'month' ? 'month' : 'week';

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [quote, setQuote] = useState<FeeQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [line1, setLine1] = useState('');
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('PL');
  const [unusedSlotId, setUnusedSlotId] = useState<number | null>(null);
  const [paymentId, setPaymentId] = useState<number | null>(null);
  const payInFlight = useRef(false);

  const isPromote = kind === 'promote';
  const topPad = Math.max(insets.top, Platform.OS === 'android' ? 28 : 0) + 12;

  const token = useCallback(async () =>
    (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token')) ?? '', []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const authToken = await token();
        if (isPromote) {
          if (!listingId) throw new Error('Brak ogłoszenia');
          const response = await fetch(`${API_URL}/api/market/${listingId}/promote/quote`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${authToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ duration }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || data.message || 'Wycena niedostępna');
          if (data.publishableKey) {
            await initStripe({ publishableKey: data.publishableKey, urlScheme: 'vroom' });
          }
          if (!active) return;
          setQuote({
            amount: data.amount,
            taxAmount: null,
            totalAmount: null,
            currency: 'PLN',
          });
        } else {
          const response = await fetch(`${API_URL}/api/market/listing-slot/quote`, {
            headers: { Authorization: `Bearer ${authToken}` },
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || data.message || 'Wycena niedostępna');
          if (data.publishableKey) {
            await initStripe({ publishableKey: data.publishableKey, urlScheme: 'vroom' });
          }
          if (!active) return;
          setUnusedSlotId(data.unusedPaidSlotId || null);
          setQuote({
            amount: data.amount,
            taxAmount: null,
            totalAmount: null,
            currency: data.currency || 'PLN',
          });
        }
      } catch (error: any) {
        showToast({ type: 'error', text1: 'Nie można otworzyć płatności', text2: error.message });
        router.back();
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [duration, isPromote, listingId, router, token]);

  const waitForPaid = useCallback(async (id: number) => {
    const authToken = await token();
    const path = isPromote
      ? `/api/market/promote-payments/${id}`
      : `/api/market/listing-slot/payments/${id}`;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await fetch(`${API_URL}${path}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await response.json();
      const status = data.payment?.status;
      if (status === 'paid' || status === 'consumed') return true;
      if (status === 'failed' || status === 'refunded') return false;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return null;
  }, [isPromote, token]);

  const pay = async () => {
    if (payInFlight.current) return;

    if (!isPromote && unusedSlotId) {
      await AsyncStorage.setItem('marketPaidSlotId', String(unusedSlotId));
      showToast({ type: 'success', text1: 'Masz już opłacony slot', text2: 'Wyślij ogłoszenie ponownie.' });
      router.back();
      return;
    }

    if (!line1.trim() || !city.trim() || !postalCode.trim() || country.trim().length !== 2) {
      showToast({ type: 'error', text1: 'Uzupełnij adres rozliczeniowy' });
      return;
    }

    payInFlight.current = true;
    setPaying(true);
    try {
      const authToken = await token();
      const billingAddress = {
        line1: line1.trim(),
        city: city.trim(),
        postalCode: postalCode.trim(),
        country: country.trim().toUpperCase(),
      };
      const endpoint = isPromote
        ? `${API_URL}/api/market/${listingId}/promote/payment-intent`
        : `${API_URL}/api/market/listing-slot/payment-intent`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          billingAddress,
          duration: isPromote ? duration : undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || data.message || `Błąd płatności (${response.status})`);
      }

      if (data.alreadyPaid && data.paymentId) {
        if (isPromote) {
          showToast({ type: 'success', text1: 'Promowanie już aktywne' });
          router.back();
        } else {
          await AsyncStorage.setItem('marketPaidSlotId', String(data.paymentId));
          showToast({ type: 'success', text1: 'Slot już opłacony', text2: 'Wyślij ogłoszenie ponownie.' });
          router.back();
        }
        return;
      }

      if (!data.clientSecret || !data.publishableKey || !data.paymentId) {
        throw new Error('Niepełna konfiguracja płatności Stripe');
      }
      if (data.quote) setQuote(data.quote);
      setPaymentId(Number(data.paymentId));

      console.info('[MARKET_FEE_CHECKOUT] Initializing Stripe');
      await initStripe({
        publishableKey: data.publishableKey,
        urlScheme: 'vroom',
      });
      console.info('[MARKET_FEE_CHECKOUT] Initializing Payment Sheet');
      const initialized = await initPaymentSheet({
        merchantDisplayName: 'VROOM',
        paymentIntentClientSecret: data.clientSecret,
        returnURL: 'vroom://stripe-redirect',
        allowsDelayedPaymentMethods: false,
        defaultBillingDetails: {
          address: {
            line1: billingAddress.line1,
            city: billingAddress.city,
            postalCode: billingAddress.postalCode,
            country: billingAddress.country,
          },
        },
      });
      if (initialized.error) throw new Error(initialized.error.message);

      console.info('[MARKET_FEE_CHECKOUT] Presenting Payment Sheet');
      const result = await presentPaymentSheet();
      if (result.error) {
        if (result.error.code !== 'Canceled') throw new Error(result.error.message);
        return;
      }

      const confirmed = await waitForPaid(Number(data.paymentId));
      if (confirmed) {
        if (isPromote) {
          showToast({ type: 'success', text1: 'Ogłoszenie promowane' });
          router.back();
        } else {
          await AsyncStorage.setItem('marketPaidSlotId', String(data.paymentId));
          showToast({ type: 'success', text1: 'Slot opłacony', text2: 'Wyślij ogłoszenie ponownie.' });
          router.back();
        }
      } else if (confirmed === null) {
        showToast({
          type: 'info',
          text1: 'Płatność jest przetwarzana',
          text2: isPromote
            ? 'Promowanie pojawi się po potwierdzeniu przez Stripe.'
            : 'Slot będzie aktywny po potwierdzeniu przez Stripe.',
        });
      } else {
        throw new Error('Stripe nie potwierdził płatności');
      }
    } catch (error: any) {
      console.error('[MARKET_FEE_CHECKOUT] Payment failed', {
        message: error?.message,
        code: error?.code,
      });
      showToast({ type: 'error', text1: 'Płatność nieudana', text2: error.message });
    } finally {
      payInFlight.current = false;
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  const inputStyle = {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 12,
    color: theme.text,
    paddingHorizontal: 14,
    paddingVertical: 12,
  } as const;

  const headline = isPromote
    ? (duration === 'month' ? 'Promowanie 30 dni' : 'Promowanie 7 dni')
    : 'Dodatkowy slot ogłoszenia';

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: topPad, gap: 16, paddingBottom: 40 }}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <MaterialIcons name="arrow-back" size={22} color={theme.text} />
          <Text style={{ color: theme.text }}>Wróć</Text>
        </TouchableOpacity>

        <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 22 }}>{headline}</Text>
        <Text style={{ color: theme.textDim, lineHeight: 20 }}>
          {isPromote
            ? 'Podaj adres rozliczeniowy. Stripe Tax obliczy finalny podatek przed otwarciem bezpiecznej płatności.'
            : 'Opłata za dodatkowe aktywne ogłoszenie ponad Twój limit. Stripe Tax doliczy podatek przed płatnością.'}
        </Text>

        {!isPromote && unusedSlotId ? (
          <View style={{ backgroundColor: theme.surface, borderRadius: 16, borderWidth: 1, borderColor: theme.border, padding: 16 }}>
            <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 13 }}>
              Masz już opłacony niewykorzystany slot
            </Text>
          </View>
        ) : (
          <View style={{ backgroundColor: theme.surface, borderRadius: 16, borderWidth: 1, borderColor: theme.border, padding: 16, gap: 8 }}>
            <Text style={{ color: theme.textDim }}>Cena przed podatkiem</Text>
            <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 18 }}>
              {money(quote?.amount, quote?.currency)}
            </Text>
            {quote?.totalAmount != null && (
              <>
                <Text style={{ color: theme.textDim }}>Podatek: {money(quote.taxAmount, quote.currency)}</Text>
                <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 20 }}>
                  Do zapłaty: {money(quote.totalAmount, quote.currency)}
                </Text>
              </>
            )}
          </View>
        )}

        {!unusedSlotId && (
          <>
            <TextInput style={inputStyle} value={line1} onChangeText={setLine1} placeholder="Ulica i numer" placeholderTextColor={theme.textDim} />
            <TextInput style={inputStyle} value={city} onChangeText={setCity} placeholder="Miasto" placeholderTextColor={theme.textDim} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TextInput style={[inputStyle, { flex: 1 }]} value={postalCode} onChangeText={setPostalCode} placeholder="Kod pocztowy" placeholderTextColor={theme.textDim} />
              <TextInput style={[inputStyle, { width: 82 }]} value={country} onChangeText={setCountry} autoCapitalize="characters" maxLength={2} placeholder="PL" placeholderTextColor={theme.textDim} />
            </View>
          </>
        )}

        <TouchableOpacity
          onPress={pay}
          disabled={paying}
          style={{ backgroundColor: theme.primary, borderRadius: 14, padding: 16, alignItems: 'center', opacity: paying ? 0.7 : 1 }}
        >
          {paying
            ? <ActivityIndicator color="#fff" />
            : (
              <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontWeight: '700' }}>
                {unusedSlotId
                  ? 'Użyj opłaconego slotu'
                  : quote?.totalAmount != null
                    ? `Zapłać ${money(quote.totalAmount, quote.currency)}`
                    : 'Oblicz podatek i zapłać'}
              </Text>
            )}
        </TouchableOpacity>
        {paymentId != null && (
          <Text style={{ color: theme.textDim, textAlign: 'center', fontSize: 11 }}>Płatność #{paymentId}</Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
