import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_URL } from '../../constants/config';
import { useTheme } from '../../contexts/ThemeContext';
import { getAuthToken } from '../../lib/getAuthToken';
import { normalizeMediaUri } from '../../lib/mediaUri';

type Tab = 'info' | 'offers' | 'events' | 'reviews';
type Offer = {
  id: number;
  title: string;
  description?: string;
  imageUrl?: string;
  redemptionType: 'display_code' | 'claim_qr' | 'external_link';
  externalUrl?: string;
  endsAt?: string;
};
type PartnerEvent = {
  id: number;
  title: string;
  description?: string;
  coverImageUrl?: string;
  startsAt: string;
  locationName?: string;
  capacity?: number;
  _count?: { registrations: number };
};
type Claim = {
  id: number;
  offerId: number;
  claimToken: string;
  status: string;
  displayCode?: string | null;
};

async function authFetch(path: string, init: RequestInit = {}) {
  const token = await getAuthToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Nie udało się wykonać operacji');
  return data;
}

export default function PartnerHubScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const partnerId = Number(id);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useTheme();
  const [tab, setTab] = useState<Tab>('info');
  const [detail, setDetail] = useState<any>(null);
  const [hub, setHub] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [claims, setClaims] = useState<Record<number, Claim>>({});
  const [rsvp, setRsvp] = useState<Record<number, boolean>>({});
  const [leadOpen, setLeadOpen] = useState(false);
  const [lead, setLead] = useState({
    contactName: '', contactEmail: '', contactPhone: '', message: '', consent: false,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [detailData, hubData] = await Promise.all([
        authFetch(`/api/partner-pois/${partnerId}/detail`),
        authFetch(`/api/partner-pois/${partnerId}/hub`),
      ]);
      setDetail(detailData);
      setHub(hubData);
      setClaims(Object.fromEntries((hubData.myClaims || []).map((item: Claim) => [item.offerId, item])));
      setRsvp(Object.fromEntries(
        (hubData.myRegistrations || [])
          .filter((item: any) => item.status !== 'cancelled')
          .map((item: any) => [item.eventId, true]),
      ));
    } catch (requestError: any) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [partnerId]);

  useEffect(() => {
    if (Number.isFinite(partnerId)) void load();
  }, [load, partnerId]);

  const poi = detail?.poi;
  const locationId = poi?.businessLocationId;
  const accent = poi?.markerAccentColor || '#ff3b3f';
  const card = isDark ? '#12161a' : '#f5f6f7';
  const border = isDark ? '#262d34' : '#e1e4e7';
  const metric = (type: string, extra: object = {}) => locationId
    ? authFetch('/api/partner-metrics', {
      method: 'POST',
      body: JSON.stringify({ type, businessLocationId: locationId, ...extra }),
    }).catch(() => {})
    : Promise.resolve();

  const claimOffer = async (offer: Offer) => {
    setMessage('');
    try {
      if (offer.redemptionType === 'external_link' && offer.externalUrl) {
        await metric('offer_view', { offerId: offer.id });
        await Linking.openURL(offer.externalUrl);
        return;
      }
      const data = await authFetch(`/api/partner-offers/${offer.id}/claim`, { method: 'POST' });
      setClaims((value) => ({ ...value, [offer.id]: data.claim }));
      setMessage('Kupon został zapisany w „Moich korzyściach”.');
    } catch (requestError: any) {
      setMessage(requestError.message);
    }
  };

  const toggleRsvp = async (event: PartnerEvent) => {
    setMessage('');
    try {
      if (rsvp[event.id]) {
        await authFetch(`/api/partner-events/${event.id}/rsvp`, { method: 'DELETE' });
        setRsvp((value) => ({ ...value, [event.id]: false }));
      } else {
        await authFetch(`/api/partner-events/${event.id}/rsvp`, { method: 'POST' });
        setRsvp((value) => ({ ...value, [event.id]: true }));
      }
    } catch (requestError: any) {
      setMessage(requestError.message);
    }
  };

  const sendLead = async () => {
    setMessage('');
    try {
      await authFetch('/api/partner-leads', {
        method: 'POST',
        body: JSON.stringify({ ...lead, businessLocationId: locationId, sourceType: 'profile' }),
      });
      setLeadOpen(false);
      setLead({ contactName: '', contactEmail: '', contactPhone: '', message: '', consent: false });
      setMessage('Zapytanie zostało przekazane firmie.');
    } catch (requestError: any) {
      setMessage(requestError.message);
    }
  };

  const tabs = useMemo(() => [
    { id: 'info', label: 'Informacje', icon: 'information-outline' },
    { id: 'offers', label: `Oferty ${hub?.offers?.length || ''}`, icon: 'ticket-percent-outline' },
    { id: 'events', label: `Wydarzenia ${hub?.events?.length || ''}`, icon: 'calendar-star' },
    { id: 'reviews', label: `Opinie ${detail?.stats?.reviewCount || ''}`, icon: 'star-outline' },
  ] as const, [detail?.stats?.reviewCount, hub?.events?.length, hub?.offers?.length]);

  if (loading) {
    return <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color="#ff3b3f" />
      <Text style={{ color: theme.textDim, marginTop: 12 }}>Ładowanie Partner Hub…</Text>
    </View>;
  }

  return <View style={{ flex: 1, backgroundColor: theme.bg }}>
    <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: border, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <TouchableOpacity onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: card, alignItems: 'center', justifyContent: 'center' }}>
        <MaterialCommunityIcons name="arrow-left" size={22} color={theme.text} />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={{ color: '#ff3b3f', fontFamily: 'Orbitron', fontSize: 8, letterSpacing: 1.2 }}>PARTNER VROOM</Text>
        <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 15, marginTop: 3 }} numberOfLines={1}>{poi?.name || 'Partner Hub'}</Text>
      </View>
      <TouchableOpacity onPress={() => router.push('/profile/benefits' as any)} style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: card, alignItems: 'center', justifyContent: 'center' }}>
        <MaterialCommunityIcons name="wallet-giftcard" size={21} color={accent} />
      </TouchableOpacity>
    </View>

    <View style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7 }}>
        {tabs.map((item) => <TouchableOpacity key={item.id} onPress={() => setTab(item.id)} style={{ paddingHorizontal: 13, height: 38, borderRadius: 11, borderWidth: 1, borderColor: tab === item.id ? accent : border, backgroundColor: tab === item.id ? `${accent}20` : card, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <MaterialCommunityIcons name={item.icon as any} size={16} color={tab === item.id ? accent : theme.textDim} />
          <Text style={{ color: tab === item.id ? theme.text : theme.textDim, fontSize: 11, fontWeight: '700' }}>{item.label}</Text>
        </TouchableOpacity>)}
      </ScrollView>
    </View>

    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 36, gap: 12 }} showsVerticalScrollIndicator={false}>
      {error ? <Notice text={error} danger /> : null}
      {message ? <Notice text={message} /> : null}

      {tab === 'info' && <>
        <View style={{ padding: 18, borderRadius: 18, borderWidth: 1, borderColor: border, backgroundColor: card }}>
          <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
            {poi?.logoUrl
              ? <Image source={normalizeMediaUri(poi.logoUrl) || undefined} style={{ width: 62, height: 62, borderRadius: 16 }} contentFit="contain" />
              : <View style={{ width: 62, height: 62, borderRadius: 16, backgroundColor: `${accent}20`, alignItems: 'center', justifyContent: 'center' }}><MaterialCommunityIcons name="store" size={29} color={accent} /></View>}
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.text, fontSize: 20, fontWeight: '800' }}>{poi?.name}</Text>
              <Text style={{ color: theme.textDim, marginTop: 4 }}>{poi?.address || 'Partner VROOM'}</Text>
            </View>
          </View>
          {poi?.description && <Text style={{ color: theme.textDim, lineHeight: 21, marginTop: 15 }}>{poi.description}</Text>}
        </View>
        <Action icon="phone-outline" label="Zadzwoń" disabled={!poi?.phone} onPress={async () => { await metric('phone_click'); await Linking.openURL(`tel:${poi.phone}`); }} color={accent} border={border} card={card} text={theme.text} />
        <Action icon="web" label="Otwórz stronę WWW" disabled={!poi?.websiteUrl} onPress={async () => { await metric('website_click'); await Linking.openURL(poi.websiteUrl); }} color={accent} border={border} card={card} text={theme.text} />
        <TouchableOpacity onPress={() => setLeadOpen(true)} style={{ padding: 16, borderRadius: 15, backgroundColor: '#ff3b3f', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <MaterialCommunityIcons name="message-arrow-right-outline" size={20} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '800' }}>ZAPYTAJ FIRMĘ</Text>
        </TouchableOpacity>
        {detail?.gallery?.length > 0 && <ScrollView horizontal contentContainerStyle={{ gap: 10 }}>
          {detail.gallery.map((item: any) => <Image key={item.id} source={normalizeMediaUri(item.imageUrl) || undefined} style={{ width: 250, height: 150, borderRadius: 14, backgroundColor: card }} contentFit="cover" />)}
        </ScrollView>}
      </>}

      {tab === 'offers' && (hub?.offers?.length
        ? hub.offers.map((offer: Offer) => <View key={offer.id} style={{ borderWidth: 1, borderColor: border, backgroundColor: card, borderRadius: 18, overflow: 'hidden' }}>
          {offer.imageUrl && <Image source={normalizeMediaUri(offer.imageUrl) || undefined} style={{ width: '100%', height: 170 }} contentFit="cover" />}
          <View style={{ padding: 16, gap: 9 }}>
            <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800' }}>{offer.title}</Text>
            <Text style={{ color: theme.textDim, lineHeight: 20 }}>{offer.description}</Text>
            {offer.endsAt && <Text style={{ color: accent, fontSize: 11 }}>Ważna do {new Date(offer.endsAt).toLocaleDateString('pl-PL')}</Text>}
            {claims[offer.id]
              ? <View style={{ padding: 14, borderRadius: 13, backgroundColor: '#fff', alignItems: 'center', gap: 9 }}>
                {offer.redemptionType === 'claim_qr' && <QRCode value={claims[offer.id].claimToken} size={120} />}
                <Text selectable style={{ color: '#111', fontWeight: '900', letterSpacing: 1 }}>{claims[offer.id].displayCode || claims[offer.id].claimToken}</Text>
              </View>
              : <TouchableOpacity onPress={() => claimOffer(offer)} style={{ padding: 14, borderRadius: 13, backgroundColor: accent, alignItems: 'center' }}>
                <Text style={{ color: '#050505', fontWeight: '900' }}>{offer.redemptionType === 'external_link' ? 'PRZEJDŹ DO OFERTY' : 'POBIERZ KUPON'}</Text>
              </TouchableOpacity>}
          </View>
        </View>)
        : <Empty icon="ticket-percent-outline" title="Brak aktywnych ofert" text="Partner nie opublikował obecnie żadnej promocji." color={theme.textDim} />)}

      {tab === 'events' && (hub?.events?.length
        ? hub.events.map((event: PartnerEvent) => <View key={event.id} style={{ borderWidth: 1, borderColor: border, backgroundColor: card, borderRadius: 18, overflow: 'hidden' }}>
          {event.coverImageUrl && <Image source={normalizeMediaUri(event.coverImageUrl) || undefined} style={{ width: '100%', height: 170 }} contentFit="cover" />}
          <View style={{ padding: 16, gap: 8 }}>
            <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800' }}>{event.title}</Text>
            <Text style={{ color: accent, fontWeight: '700' }}>{new Date(event.startsAt).toLocaleString('pl-PL')}</Text>
            <Text style={{ color: theme.textDim }}>{event.locationName}</Text>
            <Text style={{ color: theme.textDim, lineHeight: 20 }}>{event.description}</Text>
            <Text style={{ color: theme.textDim, fontSize: 11 }}>{event._count?.registrations || 0}{event.capacity ? ` / ${event.capacity}` : ''} zapisanych</Text>
            <TouchableOpacity onPress={() => toggleRsvp(event)} style={{ padding: 14, borderRadius: 13, borderWidth: 1, borderColor: rsvp[event.id] ? '#43d17b' : accent, backgroundColor: rsvp[event.id] ? '#43d17b20' : `${accent}18`, alignItems: 'center' }}>
              <Text style={{ color: rsvp[event.id] ? '#43d17b' : accent, fontWeight: '900' }}>{rsvp[event.id] ? 'ANULUJ ZAPIS' : 'ZAPISZ SIĘ'}</Text>
            </TouchableOpacity>
          </View>
        </View>)
        : <Empty icon="calendar-blank-outline" title="Brak nadchodzących wydarzeń" text="Nowe wydarzenia partnera pojawią się tutaj." color={theme.textDim} />)}

      {tab === 'reviews' && (detail?.reviews?.length
        ? detail.reviews.map((review: any) => <View key={review.id} style={{ padding: 15, borderRadius: 15, borderWidth: 1, borderColor: border, backgroundColor: card }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: theme.text, fontWeight: '800' }}>{review.user.username}</Text>
            <Text style={{ color: '#f5b942' }}>{'★'.repeat(review.rating)}</Text>
          </View>
          {review.comment && <Text style={{ color: theme.textDim, marginTop: 8, lineHeight: 20 }}>{review.comment}</Text>}
          {review.reply && <View style={{ marginTop: 12, padding: 12, borderLeftWidth: 2, borderLeftColor: accent, backgroundColor: `${accent}10` }}>
            <Text style={{ color: accent, fontSize: 10, fontWeight: '800' }}>ODPOWIEDŹ FIRMY</Text>
            <Text style={{ color: theme.textDim, marginTop: 5 }}>{review.reply.body}</Text>
          </View>}
        </View>)
        : <Empty icon="star-outline" title="Brak opinii" text="Bądź pierwszą osobą, która oceni tego partnera." color={theme.textDim} />)}
    </ScrollView>

    <Modal visible={leadOpen} transparent animationType="slide" onRequestClose={() => setLeadOpen(false)}>
      <Pressable onPress={() => setLeadOpen(false)} style={{ flex: 1, backgroundColor: '#000a', justifyContent: 'flex-end' }}>
        <Pressable onPress={(event) => event.stopPropagation()} style={{ padding: 20, paddingBottom: insets.bottom + 20, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: theme.surface, gap: 12 }}>
          <Text style={{ color: theme.text, fontSize: 20, fontWeight: '900' }}>Zapytaj firmę</Text>
          <Text style={{ color: theme.textDim }}>Firma otrzyma dane wyłącznie po zaznaczeniu zgody.</Text>
          {([['contactName', 'Imię i nazwisko'], ['contactEmail', 'Email'], ['contactPhone', 'Telefon']] as const).map(([key, placeholder]) => <TextInput key={key} value={lead[key]} onChangeText={(value) => setLead((current) => ({ ...current, [key]: value }))} placeholder={placeholder} placeholderTextColor="#66717d" style={{ color: theme.text, borderWidth: 1, borderColor: border, backgroundColor: card, borderRadius: 12, padding: 13 }} />)}
          <TextInput value={lead.message} onChangeText={(value) => setLead((current) => ({ ...current, message: value }))} placeholder="W czym firma może Ci pomóc?" placeholderTextColor="#66717d" multiline style={{ minHeight: 90, color: theme.text, borderWidth: 1, borderColor: border, backgroundColor: card, borderRadius: 12, padding: 13, textAlignVertical: 'top' }} />
          <TouchableOpacity onPress={() => setLead((current) => ({ ...current, consent: !current.consent }))} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
            <MaterialCommunityIcons name={lead.consent ? 'checkbox-marked' : 'checkbox-blank-outline'} size={23} color={lead.consent ? accent : theme.textDim} />
            <Text style={{ flex: 1, color: theme.textDim, lineHeight: 19 }}>Zgadzam się na przekazanie powyższych danych tej firmie w celu odpowiedzi na zapytanie.</Text>
          </TouchableOpacity>
          <TouchableOpacity disabled={!lead.consent} onPress={sendLead} style={{ padding: 15, borderRadius: 13, backgroundColor: '#ff3b3f', alignItems: 'center', opacity: lead.consent ? 1 : .45 }}>
            <Text style={{ color: '#fff', fontWeight: '900' }}>WYŚLIJ ZAPYTANIE</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  </View>;
}

function Notice({ text, danger = false }: { text: string; danger?: boolean }) {
  return <View style={{ padding: 12, borderRadius: 12, backgroundColor: danger ? '#ff5a6318' : '#43d17b18', borderWidth: 1, borderColor: danger ? '#ff5a6340' : '#43d17b40' }}>
    <Text style={{ color: danger ? '#ff7a80' : '#70dfa0' }}>{text}</Text>
  </View>;
}

function Action({ icon, label, onPress, disabled, color, border, card, text }: any) {
  return <TouchableOpacity disabled={disabled} onPress={onPress} style={{ padding: 15, borderRadius: 14, borderWidth: 1, borderColor: border, backgroundColor: card, flexDirection: 'row', alignItems: 'center', gap: 11, opacity: disabled ? .4 : 1 }}>
    <MaterialCommunityIcons name={icon} size={21} color={color} />
    <Text style={{ flex: 1, color: text, fontWeight: '700' }}>{label}</Text>
    <MaterialCommunityIcons name="chevron-right" size={20} color={color} />
  </TouchableOpacity>;
}

function Empty({ icon, title, text, color }: any) {
  return <View style={{ padding: 42, alignItems: 'center' }}>
    <MaterialCommunityIcons name={icon} size={32} color={color} />
    <Text style={{ color, fontWeight: '800', marginTop: 12 }}>{title}</Text>
    <Text style={{ color, textAlign: 'center', marginTop: 6 }}>{text}</Text>
  </View>;
}
