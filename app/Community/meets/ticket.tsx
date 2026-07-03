import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, ActivityIndicator, StatusBar, Image,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../../contexts/ThemeContext';
import { API_URL } from '../../../constants/config';
import { CommunityScreenHeader } from '../../../components/community';

interface TicketCar {
  id: number;
  brand: string;
  specs: string;
  photos: string[];
}

interface TicketData {
  ticketKind: 'visitor' | 'participant';
  qrPayload: string;
  joinedAt: string;
  checkedInAt: string | null;
  entryType: string | null;
  participantStatus: string | null;
  car: TicketCar | null;
}

function formatDt(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pl-PL', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function MeetTicketScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme, isDark } = useTheme();

  const [ticket, setTicket] = useState<TicketData | null>(null);
  const [loading, setLoading] = useState(true);

  const getToken = async () =>
    (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token')) ?? '';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const r = await fetch(`${API_URL}/api/meets/${id}/my-ticket`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Brak biletu');
      setTicket(data);
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: e.message });
      router.back();
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  if (!ticket) return null;

  const isParticipant = ticket.ticketKind === 'participant';
  const checkedIn = !!ticket.checkedInAt;
  const isFree = ticket.entryType === 'free_vroom';
  const carPhoto = ticket.car?.photos?.[0];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <CommunityScreenHeader
        title={isParticipant ? 'BILET UCZESTNIKA' : 'TWÓJ BILET'}
        subtitle={isParticipant ? 'QR wjazdu z autem' : 'Kod QR wydarzenia'}
      />

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 20 }}>
        {isParticipant && ticket.car && (
          <View style={{ backgroundColor: '#4de92615', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: '#4de92640', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 72, height: 54, borderRadius: 10, overflow: 'hidden', backgroundColor: theme.surface, alignItems: 'center', justifyContent: 'center' }}>
              {carPhoto
                ? <Image source={{ uri: carPhoto }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                : <MaterialCommunityIcons name="car-sports" size={28} color="#4de926" />
              }
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#4de926', fontFamily: 'Orbitron', fontSize: 9, letterSpacing: 1 }}>ZATWIERDZONE AUTO</Text>
              <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 13, fontWeight: '700', marginTop: 4 }}>
                {ticket.car.brand} {ticket.car.specs}
              </Text>
            </View>
          </View>
        )}

        <View style={{
          backgroundColor: theme.surface, borderRadius: 20, padding: 24, alignItems: 'center',
          borderWidth: 1, borderColor: isParticipant ? '#4de92640' : theme.border, gap: 16,
        }}>
          <View style={{ backgroundColor: '#fff', padding: 16, borderRadius: 16 }}>
            <QRCode value={ticket.qrPayload} size={220} />
          </View>
          <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9, letterSpacing: 1, textAlign: 'center' }}>
            {isParticipant
              ? 'KOD UCZESTNIKA Z AUTEM — INNY NIŻ BILET GOŚCIA'
              : 'POKAŻ TEN KOD ORGANIZATOROWI NA MIEJSCU'}
          </Text>
        </View>

        <View style={{ backgroundColor: theme.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: theme.border, gap: 12 }}>
          <Row label="Typ biletu" value={isParticipant ? 'Uczestnik z autem' : 'Gość / użytkownik'} theme={theme} accent={isParticipant ? '#4de926' : theme.primary} />
          <Row label="Dołączyłeś w apce" value={formatDt(ticket.joinedAt)} theme={theme} />
          <Row label="Status wjazdu" value={checkedIn ? 'Zeskanowany na miejscu' : 'Oczekuje na skan'} theme={theme} accent={checkedIn ? '#4de926' : theme.primary} />
          {checkedIn && (
            <>
              <Row label="Czas check-inu" value={formatDt(ticket.checkedInAt)} theme={theme} />
              <Row
                label="Typ wjazdu"
                value={isFree ? 'FREE VROOM' : 'Standardowy'}
                theme={theme}
                accent={isFree ? '#f5c518' : theme.text}
              />
            </>
          )}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: theme.primaryBg, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.primaryBorder }}>
          <MaterialIcons name="info-outline" size={20} color={theme.primary} />
          <Text style={{ flex: 1, color: theme.textDim, fontSize: 12, lineHeight: 18 }}>
            {isParticipant
              ? 'Ten kod QR jest ważny tylko po zatwierdzeniu przez organizatora. Skanowany przy wjeździe na teren z autem.'
              : 'Bilet jest ważny po zapisaniu się na wydarzenie w aplikacji VROOM. Organizator zeskanuje kod przy wjeździe.'}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function Row({ label, value, theme, accent }: { label: string; value: string; theme: any; accent?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9, letterSpacing: 1 }}>{label}</Text>
      <Text style={{ color: accent || theme.text, fontFamily: 'Orbitron', fontSize: 11, fontWeight: '700', textAlign: 'right', flex: 1 }}>{value}</Text>
    </View>
  );
}
