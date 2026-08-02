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

type Quote = {
  itemAmount: number;
  sellerNetAmount: number;
  platformFeeAmount: number;
  subtotalAmount: number;
  taxAmount: number | null;
  totalAmount: number | null;
  currency: string;
  escrowAutoReleaseDays?: number;
};

const money = (amount: number | null | undefined, currency = 'PLN') =>
  amount == null ? '—' : `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;

const showToast = (options: Record<string, unknown>) => Toast.show(options as never);

export default function MarketCheckoutScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [line1, setLine1] = useState('');
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('PL');
  const buyInFlight = useRef(false);
  const topPad = Math.max(insets.top, Platform.OS === 'android' ? 28 : 0) + 12;

  const token = useCallback(async () =>
    (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token')) ?? '', []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const authToken = await token();
        const response = await fetch(`${API_URL}/api/market/${id}/purchase-quote`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Zakup niedostępny');
        if (data.publishableKey) {
          await initStripe({ publishableKey: data.publishableKey, urlScheme: 'vroom' });
        }
        if (!active) return;
        setQuote(data.quote);
        setTitle(data.listing?.title || 'Ogłoszenie');
        if (data.order?.status === 'paid_held' || data.order?.status === 'released') {
          showToast({ type: 'info', text1: 'Masz już zamówienie dla tego ogłoszenia' });
          router.replace({ pathname: '/Community/market/orders', params: { focus: data.order.id } } as any);
        }
      } catch (error: any) {
        showToast({ type: 'error', text1: 'Nie można kupić', text2: error.message });
        router.back();
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [id, router, token]);

  const waitForWebhook = useCallback(async (orderId: string) => {
    const authToken = await token();
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await fetch(`${API_URL}/api/market/orders/${orderId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await response.json();
      if (data.order?.status === 'paid_held' || data.order?.status === 'released') return true;
      if (['failed', 'refunded', 'cancelled', 'expired'].includes(data.order?.status)) return false;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return null;
  }, [token]);

  const buy = async () => {
    if (buyInFlight.current) return;
    if (!line1.trim() || !city.trim() || !postalCode.trim() || country.trim().length !== 2) {
      showToast({ type: 'error', text1: 'Uzupełnij adres rozliczeniowy' });
      return;
    }
    buyInFlight.current = true;
    setPaying(true);
    try {
      const authToken = await token();
      const response = await fetch(`${API_URL}/api/market/${id}/payment-intent`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          billingAddress: {
            line1: line1.trim(),
            city: city.trim(),
            postalCode: postalCode.trim(),
            country: country.trim().toUpperCase(),
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Nie udało się utworzyć płatności');
      if (data.alreadyPaid) {
        showToast({ type: 'success', text1: 'Zamówienie już opłacone' });
        router.replace('/Community/market/orders' as any);
        return;
      }
      if (!data.clientSecret || !data.publishableKey || !data.order?.id) {
        throw new Error('Niepełna konfiguracja płatności Stripe');
      }
      setQuote(data.quote);
      await initStripe({ publishableKey: data.publishableKey, urlScheme: 'vroom' });
      const initialized = await initPaymentSheet({
        merchantDisplayName: 'VROOM',
        paymentIntentClientSecret: data.clientSecret,
        returnURL: 'vroom://stripe-redirect',
        allowsDelayedPaymentMethods: false,
        defaultBillingDetails: {
          address: {
            line1: line1.trim(),
            city: city.trim(),
            postalCode: postalCode.trim(),
            country: country.trim().toUpperCase(),
          },
        },
      });
      if (initialized.error) throw new Error(initialized.error.message);
      const result = await presentPaymentSheet();
      if (result.error) {
        if (result.error.code !== 'Canceled') throw new Error(result.error.message);
        return;
      }
      const confirmed = await waitForWebhook(data.order.id);
      if (confirmed) {
        showToast({
          type: 'success',
          text1: 'Zakup udany',
          text2: 'Środki w escrow — potwierdź odbiór po spotkaniu.',
        });
        router.replace('/Community/market/orders' as any);
      } else if (confirmed === null) {
        showToast({ type: 'info', text1: 'Płatność jest przetwarzana' });
        router.replace('/Community/market/orders' as any);
      } else {
        throw new Error('Stripe nie potwierdził płatności');
      }
    } catch (error: any) {
      showToast({ type: 'error', text1: 'Płatność nieudana', text2: error.message });
    } finally {
      buyInFlight.current = false;
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg ?? theme.background, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.bg ?? theme.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: topPad, gap: 14, paddingBottom: 40 }}>
        <TouchableOpacity onPress={() => router.back()} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <MaterialIcons name="arrow-back" size={22} color={theme.text} />
          <Text style={{ color: theme.text }}>Wróć</Text>
        </TouchableOpacity>

        <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 22, fontWeight: '800' }}>Kup na Giełdzie</Text>
        <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 18 }}>{title}</Text>
        <Text style={{ color: theme.textDim, fontSize: 12, lineHeight: 17 }}>
          Płatność jest blokowana w escrow. Po odbiorze potwierdź w aplikacji — wtedy sprzedawca dostanie środki.
        </Text>

        <View style={{ backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.border, padding: 14, gap: 8 }}>
          <Text style={{ color: theme.textDim }}>Cena przedmiotu: {money(quote?.itemAmount, quote?.currency)}</Text>
          <Text style={{ color: theme.textDim }}>Prowizja VROOM: {money(quote?.platformFeeAmount, quote?.currency)}</Text>
          <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 16 }}>
            Przed podatkiem: {money(quote?.subtotalAmount, quote?.currency)}
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

        <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 12, marginTop: 4 }}>Adres rozliczeniowy</Text>
        <TextInput
          placeholder="Ulica i numer"
          placeholderTextColor={theme.textDim}
          value={line1}
          onChangeText={setLine1}
          style={{ backgroundColor: theme.surface, color: theme.text, borderRadius: 12, borderWidth: 1, borderColor: theme.border, padding: 14 }}
        />
        <TextInput
          placeholder="Miasto"
          placeholderTextColor={theme.textDim}
          value={city}
          onChangeText={setCity}
          style={{ backgroundColor: theme.surface, color: theme.text, borderRadius: 12, borderWidth: 1, borderColor: theme.border, padding: 14 }}
        />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TextInput
            placeholder="Kod pocztowy"
            placeholderTextColor={theme.textDim}
            value={postalCode}
            onChangeText={setPostalCode}
            style={{ flex: 1, backgroundColor: theme.surface, color: theme.text, borderRadius: 12, borderWidth: 1, borderColor: theme.border, padding: 14 }}
          />
          <TextInput
            placeholder="PL"
            placeholderTextColor={theme.textDim}
            value={country}
            onChangeText={setCountry}
            autoCapitalize="characters"
            maxLength={2}
            style={{ width: 72, backgroundColor: theme.surface, color: theme.text, borderRadius: 12, borderWidth: 1, borderColor: theme.border, padding: 14, textAlign: 'center' }}
          />
        </View>

        <TouchableOpacity
          onPress={buy}
          disabled={paying}
          style={{
            marginTop: 8,
            backgroundColor: theme.primary,
            borderRadius: 14,
            paddingVertical: 16,
            alignItems: 'center',
            opacity: paying ? 0.7 : 1,
          }}
        >
          {paying
            ? <ActivityIndicator color="#fff" />
            : (
              <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontWeight: '700' }}>
                {quote?.totalAmount != null ? `Zapłać ${money(quote.totalAmount, quote.currency)}` : 'Oblicz podatek i zapłać'}
              </Text>
            )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
