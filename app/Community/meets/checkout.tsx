import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, TouchableOpacity, View } from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from '../../../components/ui/AppText';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initStripe, useStripe } from '@stripe/stripe-react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import Toast from 'react-native-toast-message';
import { API_URL } from '../../../constants/config';
import { useTheme } from '../../../contexts/ThemeContext';

type Quote = {
  organizerNetAmount: number;
  platformFeeAmount: number;
  subtotalAmount: number;
  taxAmount: number | null;
  totalAmount: number | null;
  currency: string;
};

const money = (amount: number | null | undefined, currency = 'PLN') =>
  amount == null ? '—' : `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;

const showToast = (options: Record<string, unknown>) => Toast.show(options as never);

export default function MeetTicketCheckoutScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { theme } = useTheme();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [line1, setLine1] = useState('');
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('PL');
  const buyInFlight = useRef(false);

  const token = useCallback(async () =>
    (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token')) ?? '', []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const authToken = await token();
        const response = await fetch(`${API_URL}/api/ticketing/meets/${id}`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Sprzedaż jest niedostępna');
        if (data.publishableKey) {
          await initStripe({
            publishableKey: data.publishableKey,
            urlScheme: 'vroom',
          });
        }
        if (active) {
          setQuote(data.quote);
          if (data.order?.status === 'paid' || data.order?.status === 'settled') {
            showToast({ type: 'success', text1: 'Bilet jest już aktywny' });
            router.back();
          }
        }
      } catch (error: any) {
        showToast({ type: 'error', text1: 'Nie można kupić biletu', text2: error.message });
        router.back();
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [id, router, token]);

  const waitForWebhook = useCallback(async (currentOrderId: string) => {
    const authToken = await token();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await fetch(`${API_URL}/api/ticketing/orders/${currentOrderId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await response.json();
      if (data.order?.status === 'paid' || data.order?.status === 'settled') return true;
      if (['failed', 'refunded', 'disputed'].includes(data.order?.status)) return false;
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
      const response = await fetch(`${API_URL}/api/ticketing/meets/${id}/payment-intent`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          billingAddress: {
            line1,
            city,
            postalCode,
            country: country.toUpperCase(),
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Nie udało się utworzyć płatności');
      if (data.alreadyPaid) {
        showToast({ type: 'success', text1: 'Bilet jest już aktywny' });
        router.back();
        return;
      }
      if (!data.clientSecret || !data.publishableKey || !data.order?.id) {
        throw new Error('Niepełna konfiguracja płatności Stripe');
      }
      setQuote(data.quote);
      setOrderId(data.order.id);
      console.info('[TICKET_CHECKOUT] Initializing Stripe');
      await initStripe({
        publishableKey: data.publishableKey,
        urlScheme: 'vroom',
      });
      console.info('[TICKET_CHECKOUT] Initializing Payment Sheet');
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
      console.info('[TICKET_CHECKOUT] Presenting Payment Sheet');
      const result = await presentPaymentSheet();
      if (result.error) {
        if (result.error.code !== 'Canceled') throw new Error(result.error.message);
        return;
      }
      const confirmed = await waitForWebhook(data.order.id);
      if (confirmed) {
        showToast({ type: 'success', text1: 'Bilet kupiony', text2: 'Kod QR jest już dostępny przy wydarzeniu.' });
        router.back();
      } else if (confirmed === null) {
        showToast({ type: 'info', text1: 'Płatność jest przetwarzana', text2: 'Bilet pojawi się po potwierdzeniu przez Stripe.' });
      } else {
        throw new Error('Stripe nie potwierdził płatności');
      }
    } catch (error: any) {
      console.error('[TICKET_CHECKOUT] Payment failed', {
        message: error?.message,
        code: error?.code,
        type: error?.type,
      });
      showToast({ type: 'error', text1: 'Płatność nieudana', text2: error.message });
    } finally {
      buyInFlight.current = false;
      setPaying(false);
    }
  };

  if (loading) {
    return <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={theme.primary} /></View>;
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

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 56, gap: 16 }}>
        <TouchableOpacity onPress={() => router.back()} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <MaterialIcons name="arrow-back" size={22} color={theme.text} />
          <Text style={{ color: theme.text }}>Wróć</Text>
        </TouchableOpacity>
        <Text style={{ color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 22 }}>Kup bilet w VROOM</Text>
        <Text style={{ color: theme.textDim, lineHeight: 20 }}>
          Podaj adres rozliczeniowy. Stripe Tax obliczy finalny podatek przed otwarciem bezpiecznej płatności.
        </Text>

        <View style={{ backgroundColor: theme.surface, borderRadius: 16, borderWidth: 1, borderColor: theme.border, padding: 16, gap: 8 }}>
          <Text style={{ color: theme.textDim }}>Cena przed podatkiem</Text>
          <Text style={{ color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 18 }}>{money(quote?.subtotalAmount, quote?.currency)}</Text>
          {quote?.totalAmount != null && (
            <>
              <Text style={{ color: theme.textDim }}>Podatek: {money(quote.taxAmount, quote.currency)}</Text>
              <Text style={{ color: theme.primary, fontFamily: 'Manrope_600SemiBold', fontSize: 20 }}>Do zapłaty: {money(quote.totalAmount, quote.currency)}</Text>
            </>
          )}
        </View>

        <TextInput style={inputStyle} value={line1} onChangeText={setLine1} placeholder="Ulica i numer" placeholderTextColor={theme.textDim} />
        <TextInput style={inputStyle} value={city} onChangeText={setCity} placeholder="Miasto" placeholderTextColor={theme.textDim} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TextInput style={[inputStyle, { flex: 1 }]} value={postalCode} onChangeText={setPostalCode} placeholder="Kod pocztowy" placeholderTextColor={theme.textDim} />
          <TextInput style={[inputStyle, { width: 82 }]} value={country} onChangeText={setCountry} autoCapitalize="characters" maxLength={2} placeholder="PL" placeholderTextColor={theme.textDim} />
        </View>
        <TouchableOpacity
          onPress={buy}
          disabled={paying}
          style={{ backgroundColor: theme.primary, borderRadius: 14, padding: 16, alignItems: 'center', opacity: paying ? 0.7 : 1 }}
        >
          {paying
            ? <ActivityIndicator color="#fff" />
            : <Text style={{ color: '#fff', fontFamily: 'Manrope_600SemiBold', fontWeight: '700' }}>{quote?.totalAmount != null ? `Zapłać ${money(quote.totalAmount, quote.currency)}` : 'Oblicz podatek i zapłać'}</Text>}
        </TouchableOpacity>
        {orderId && <Text style={{ color: theme.textDim, textAlign: 'center', fontSize: 12 }}>Zamówienie {orderId}</Text>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
