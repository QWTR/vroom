import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Image, Linking, ScrollView, TouchableOpacity, View } from 'react-native';
import { AppText as Text } from '../../../../components/ui/AppText';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../../../../constants/config';
import { useTheme } from '../../../../contexts/ThemeContext';
import { CommunityScreenHeader } from '../../../../components/community';

type PartnerEvent = {
  id: number;
  title: string;
  description?: string | null;
  coverImageUrl?: string | null;
  locationName?: string | null;
  address?: string | null;
  startsAt: string;
  endsAt?: string | null;
  externalUrl?: string | null;
  status: string;
  isRegistered: boolean;
  businessAccount?: { companyName?: string | null } | null;
};

export default function PartnerEventScreen() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const router = useRouter();
  const { theme } = useTheme();
  const [event, setEvent] = useState<PartnerEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
      const response = await fetch(`${API_URL}/api/partner-events/${encodeURIComponent(eventId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error();
      const data = await response.json();
      setEvent(data.event);
      setMissing(false);
    } catch {
      setMissing(true);
      setEvent(null);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <CommunityScreenHeader title="WYDARZENIE" subtitle="VROOM PARTNER" onBack={() => router.back()} />
      {loading ? (
        <ActivityIndicator color={theme.primary} style={{ marginTop: 60 }} />
      ) : missing || !event ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 }}>
          <MaterialIcons name="event-busy" size={46} color={theme.textDim} />
          <Text style={{ color: theme.text, textAlign: 'center', fontFamily: 'Manrope_600SemiBold' }}>Ta treść nie jest już dostępna</Text>
          <TouchableOpacity onPress={() => router.replace('/(tabs)/community' as any)} style={{ backgroundColor: theme.primary, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 11 }}>
            <Text style={{ color: '#fff', fontFamily: 'Manrope_600SemiBold', fontSize: 12 }}>WRÓĆ DO SPOŁECZNOŚCI</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {event.coverImageUrl ? <Image source={{ uri: event.coverImageUrl }} style={{ width: '100%', height: 210, borderRadius: 18, marginBottom: 16 }} resizeMode="cover" /> : null}
          <Text style={{ color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 21, fontWeight: '800' }}>{event.title}</Text>
          <Text style={{ color: theme.primary, marginTop: 7, fontFamily: 'Manrope_600SemiBold', fontSize: 12 }}>{event.businessAccount?.companyName || 'VROOM Partner'}</Text>
          <View style={{ marginTop: 18, padding: 15, borderRadius: 16, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, gap: 10 }}>
            <Text style={{ color: theme.text }}><MaterialIcons name="schedule" size={16} color={theme.primary} />  {new Date(event.startsAt).toLocaleString('pl-PL')}</Text>
            {(event.locationName || event.address) ? <Text style={{ color: theme.textDim }}><MaterialIcons name="location-on" size={16} color={theme.primary} />  {[event.locationName, event.address].filter(Boolean).join(' · ')}</Text> : null}
            {event.isRegistered ? <Text style={{ color: '#4de926', fontFamily: 'Manrope_600SemiBold', fontSize: 12 }}>JESTEŚ ZAPISANY/A</Text> : null}
          </View>
          {event.description ? <Text style={{ color: theme.textDim, lineHeight: 22, marginTop: 18 }}>{event.description}</Text> : null}
          {event.externalUrl ? (
            <TouchableOpacity onPress={() => void Linking.openURL(event.externalUrl!)} style={{ marginTop: 20, backgroundColor: theme.primary, borderRadius: 13, alignItems: 'center', paddingVertical: 13 }}>
              <Text style={{ color: '#fff', fontFamily: 'Manrope_600SemiBold', fontSize: 12 }}>OTWÓRZ STRONĘ WYDARZENIA</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}
