import Slider from '@react-native-community/slider';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { useRadio } from '../../contexts/RadioContext';
import { useTheme } from '../../contexts/ThemeContext';
import type { ConvoySnapshot } from '../../lib/convoyLive';
import type { RadioCity, RadioMode, RadioParticipant } from '../../types/radio';
import { PremiumAvatar, PremiumName } from '../user/PremiumIdentity';

type MapLocation = { latitude: number; longitude: number } | null;

function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const x = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 12_742_000 * Math.asin(Math.sqrt(x));
}

export function VroomCbRadioPanel({
  location,
  activeConvoy,
}: {
  location: MapLocation;
  activeConvoy: ConvoySnapshot | null;
}) {
  const { theme, isDark } = useTheme();
  const radio = useRadio();
  const { loadConfig, searchCities, updateGlobalPosition } = radio;
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<RadioMode>('global');
  const [radiusKm, setRadiusKm] = useState(radio.preferences.radiusKm);
  const [cityQuery, setCityQuery] = useState('');
  const [cities, setCities] = useState<RadioCity[]>([]);
  const [selectedCity, setSelectedCity] = useState<RadioCity | null>(null);
  const [busy, setBusy] = useState(false);
  const locationLat = location?.latitude;
  const locationLng = location?.longitude;
  const lastPositionRef = useRef<{ at: number; location: { lat: number; lng: number }; radiusKm: number } | null>(null);

  useEffect(() => { void loadConfig(); }, [loadConfig]);
  useEffect(() => { setRadiusKm(radio.preferences.radiusKm); }, [radio.preferences.radiusKm]);
  useEffect(() => {
    if (!radio.config || radio.config.flags[mode]) return;
    if (radio.config.flags.private) setMode('private');
    else if (radio.config.flags.city) setMode('city');
    else if (radio.config.flags.global) setMode('global');
  }, [mode, radio.config]);

  useEffect(() => {
    if (!visible || mode !== 'city') return;
    const timer = setTimeout(() => {
      void searchCities(cityQuery).then(setCities).catch(() => setCities([]));
    }, cityQuery ? 250 : 0);
    return () => clearTimeout(timer);
  }, [cityQuery, mode, searchCities, visible]);

  useEffect(() => {
    if (radio.snapshot?.active.mode !== 'global' || locationLat == null || locationLng == null) return;
    const next = { lat: locationLat, lng: locationLng };
    const previous = lastPositionRef.current;
    const changed = !previous || distanceM(previous.location, next) >= 25 || previous.radiusKm !== radiusKm;
    if (!changed) return;
    const delay = previous ? Math.max(0, 4_000 - (Date.now() - previous.at)) : 0;
    const timer = setTimeout(() => {
      lastPositionRef.current = { at: Date.now(), location: next, radiusKm };
      void updateGlobalPosition(next, radiusKm);
    }, delay);
    return () => clearTimeout(timer);
  }, [locationLat, locationLng, radio.snapshot?.active.mode, radiusKm, updateGlobalPosition]);

  const selectedRole = useMemo(() => radio.snapshot?.participants.find((row) => row.userId === radio.snapshot?.selfUserId)?.role, [radio.snapshot]);
  const canModerate = selectedRole === 'host' || selectedRole === 'moderator';
  const moderatedParticipant = radio.snapshot?.active.mode === 'private'
    && radio.snapshot.active.voiceMode === 'moderated'
    && !canModerate;
  const pendingSelf = Boolean(radio.snapshot?.pendingSpeakerIds.includes(radio.snapshot.selfUserId));
  const connected = Boolean(radio.snapshot);
  const enabled = radio.config?.flags.enabled !== false;

  if (!enabled) return null;

  const connect = async () => {
    setBusy(true);
    try {
      if (mode === 'global') {
        if (!location) return Alert.alert('Brak lokalizacji', 'Globalne CB potrzebuje bieżącej lokalizacji.');
        await radio.updatePreferences({ radiusKm });
        await radio.connect({ mode, radiusKm, location: { lat: location.latitude, lng: location.longitude } });
      } else if (mode === 'city') {
        if (!selectedCity) return Alert.alert('Wybierz miasto', 'Wyszukaj i wybierz kanał miasta.');
        await radio.updatePreferences({ citySlug: selectedCity.slug });
        await radio.connect({ mode, citySlug: selectedCity.slug });
      } else {
        if (!activeConvoy) return Alert.alert('Brak konwoju', 'Najpierw utwórz konwój albo dołącz do istniejącego Convoy Live.');
        await radio.connect({ mode, convoyId: activeConvoy.convoy.id });
      }
      setVisible(false);
    } finally {
      setBusy(false);
    }
  };

  const participantAction = (participant: RadioParticipant) => {
    if (participant.userId === radio.snapshot?.selfUserId) return;
    const muted = radio.mutedUserIds.has(participant.userId);
    const actions: { text: string; style?: 'default' | 'cancel' | 'destructive'; onPress: () => void }[] = [
      { text: muted ? 'Włącz dźwięk' : 'Wycisz lokalnie', onPress: () => radio.setParticipantMuted(participant.userId, !muted) },
      { text: 'Zablokuj', style: 'destructive' as const, onPress: () => { void radio.blockParticipant(participant.userId); } },
    ];
    if (canModerate && radio.snapshot?.active.mode === 'private' && participant.speaking) actions.unshift({ text: 'Odbierz głos', onPress: () => { void radio.moderateSpeaker(participant.userId, false); } });
    if (radio.snapshot?.active.mode !== 'private') actions.push({
      text: 'Zgłoś głos',
      style: 'destructive' as const,
      onPress: () => { void radio.reportSpeaker(participant.userId).then((ok) => ok && Alert.alert('Zgłoszenie wysłane', 'Moderacja otrzyma zgłoszenie wraz z dostępnym buforem audio.')); },
    });
    actions.push({ text: 'Anuluj', style: 'cancel' as const, onPress: () => {} });
    Alert.alert(participant.user.username, 'Wyciszenie działa tylko w CB. Blokada ukrywa tę osobę także w pozostałych funkcjach społecznościowych VROOM.', actions);
  };

  return (
    <>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={connected ? `VROOM CB, ${radio.snapshot?.active.title}` : 'Otwórz VROOM CB'}
        onPress={() => setVisible(true)}
        activeOpacity={0.9}
        style={[
          styles.mapButton,
          { top: activeConvoy ? 118 : 66, backgroundColor: isDark ? '#10151AF2' : '#FFFFFFF2', borderColor: connected ? '#18D7A0' : '#647381' },
        ]}
      >
        <View style={[styles.radioDot, { backgroundColor: connected ? '#18D7A0' : '#7B8792' }]} />
        <MaterialCommunityIcons name={connected ? 'radio-handheld' : 'radio'} size={20} color={connected ? '#18D7A0' : theme.text} />
        <View style={styles.mapButtonCopy}>
          <Text numberOfLines={1} style={[styles.mapButtonTitle, { color: theme.text }]}>{connected ? radio.snapshot?.active.title : 'VROOM CB'}</Text>
          {connected && <Text numberOfLines={1} style={styles.mapButtonMeta}>{radio.snapshot?.participants.length || 1} osób · {radio.snapshot?.speakers.length ? `${radio.snapshot.speakers.length} mówi` : 'cisza'}</Text>}
        </View>
        {connected && (
          <Pressable
            accessibilityLabel="Nadaj Push-to-Talk"
            disabled={radio.vadArmed}
            onPress={moderatedParticipant ? () => { if (radio.isTransmitting) void radio.stopTransmission(); else void radio.startTransmission(); } : undefined}
            onPressIn={moderatedParticipant ? undefined : () => { void radio.startTransmission(); }}
            onPressOut={moderatedParticipant ? undefined : () => { void radio.stopTransmission(); }}
            style={[styles.miniPtt, radio.isTransmitting && styles.pttActive, radio.vadArmed && { opacity: 0.45 }]}
          >
            <MaterialCommunityIcons name="microphone" size={18} color="#071510" />
          </Pressable>
        )}
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="slide" onRequestClose={() => setVisible(false)}>
        <Pressable style={styles.backdrop} onPress={() => setVisible(false)} />
        <View style={[styles.sheet, { backgroundColor: theme.bg, borderColor: theme.border2 }]}> 
          <View style={styles.handle} />
          <View style={styles.header}>
            <View>
              <Text style={[styles.kicker, { color: '#18D7A0' }]}>DODATEK DO MAPY LIVE</Text>
              <Text style={[styles.title, { color: theme.text }]}>VROOM CB</Text>
            </View>
            <TouchableOpacity onPress={() => setVisible(false)} style={[styles.close, { backgroundColor: theme.surface2 }]}>
              <MaterialCommunityIcons name="close" size={22} color={theme.text} />
            </TouchableOpacity>
          </View>

          {radio.error ? <Text style={styles.error}>{radio.error}</Text> : null}
          {!radio.config?.voiceConfigured && radio.config ? <Text style={styles.warning}>Serwer głosowy nie jest jeszcze skonfigurowany.</Text> : null}

          {connected ? (
            <ScrollView contentContainerStyle={styles.connectedContent}>
              <View style={[styles.channelCard, { backgroundColor: theme.surface2, borderColor: '#18D7A055' }]}> 
                <View style={styles.channelRow}>
                  <MaterialCommunityIcons name="access-point" size={25} color="#18D7A0" />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.channelName, { color: theme.text }]}>{radio.snapshot?.active.title}</Text>
                    <Text style={styles.channelMeta}>{radio.snapshot?.participants.length} osób · {radio.snapshot?.active.mode === 'private' ? `tryb ${radio.snapshot.active.voiceMode || 'otwarty'}` : 'pozycje są ukryte'}</Text>
                  </View>
                  <TouchableOpacity onPress={() => { void radio.disconnect(); }} style={styles.leaveButton}><Text style={styles.leaveText}>WYJDŹ</Text></TouchableOpacity>
                </View>
              </View>

              <View style={[styles.vadRow, { borderColor: theme.border2 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.sectionTitle, { color: theme.text }]}>Wykrywanie mowy</Text>
                  <Text style={styles.help}>Działa także po wygaszeniu ekranu. Po ponownym połączeniu mikrofon jest wyciszony.</Text>
                </View>
                <Switch value={radio.vadArmed} onValueChange={(value) => { void radio.setVadArmed(value); }} trackColor={{ true: '#18D7A0' }} />
              </View>
              {radio.vadArmed && <View><Text style={[styles.sectionTitle, { color: theme.text }]}>Czułość: {radio.preferences.vadSensitivity}%</Text><Slider minimumValue={0} maximumValue={100} step={1} value={radio.preferences.vadSensitivity} onSlidingComplete={(value) => { void radio.updatePreferences({ vadSensitivity: value }); }} minimumTrackTintColor="#18D7A0" maximumTrackTintColor={theme.border2} thumbTintColor="#18D7A0" /><Text style={styles.help}>Próg hałasu kalibruje się automatycznie; suwakiem ustawiasz, jak łatwo mikrofon ma reagować.</Text></View>}

              {!radio.vadArmed && (
                <Pressable
                  onPress={moderatedParticipant ? () => { if (radio.isTransmitting) void radio.stopTransmission(); else void radio.startTransmission(); } : undefined}
                  onPressIn={moderatedParticipant ? undefined : () => { void radio.startTransmission(); }}
                  onPressOut={moderatedParticipant ? undefined : () => { void radio.stopTransmission(); }}
                  style={[styles.ptt, radio.isTransmitting && styles.pttActive]}
                >
                  <MaterialCommunityIcons name={radio.isTransmitting ? 'microphone' : 'microphone-outline'} size={31} color="#06140F" />
                  <Text style={styles.pttText}>{radio.isTransmitting ? 'MÓWISZ · DOTKNIJ, ABY ZAKOŃCZYĆ' : pendingSelf ? 'PROŚBA O GŁOS WYSŁANA' : moderatedParticipant ? 'DOTKNIJ, ABY POPROSIĆ O GŁOS' : 'PRZYTRZYMAJ, ABY MÓWIĆ'}</Text>
                </Pressable>
              )}

              {canModerate && (radio.snapshot?.pendingSpeakerIds.length || 0) > 0 && (
                <View>
                  <Text style={[styles.sectionTitle, { color: theme.text }]}>Prośby o głos</Text>
                  {radio.snapshot?.pendingSpeakerIds.map((id) => {
                    const participant = radio.snapshot?.participants.find((row) => row.userId === id);
                    if (!participant) return null;
                    return <View key={id} style={styles.pendingRow}><Text style={[styles.personName, { color: theme.text }]}>{participant.user.username}</Text><TouchableOpacity onPress={() => { void radio.moderateSpeaker(id, true); }} style={styles.allow}><Text style={styles.allowText}>UDZIEL GŁOSU</Text></TouchableOpacity></View>;
                  })}
                </View>
              )}

              <Text style={[styles.sectionTitle, { color: theme.text }]}>Uczestnicy</Text>
              {radio.snapshot?.participants.map((participant) => (
                <TouchableOpacity key={participant.userId} onPress={() => participantAction(participant)} activeOpacity={0.75} style={[styles.person, { borderColor: theme.border2 }]}> 
                  <PremiumAvatar user={participant.user} size={36} />
                  <View style={{ flex: 1 }}>
                    <PremiumName user={participant.user} style={[styles.personName, { color: theme.text }]} suffix={participant.userId === radio.snapshot?.selfUserId ? ' · Ty' : ''} />
                    <Text style={styles.personMeta}>{participant.speaking ? 'MÓWI TERAZ' : participant.role === 'participant' ? 'słucha' : participant.role}</Text>
                  </View>
                  {participant.speaking && <View style={styles.speaking}><MaterialCommunityIcons name="waveform" size={19} color="#18D7A0" /></View>}
                  {radio.mutedUserIds.has(participant.userId) && <MaterialCommunityIcons name="volume-off" size={19} color="#E77777" />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : (
            <View style={{ flex: 1 }}>
              <View style={[styles.tabs, { backgroundColor: theme.surface2 }]}> 
                {(['global', 'city', 'private'] as RadioMode[]).map((item) => (
                  <TouchableOpacity key={item} disabled={radio.config?.flags[item] === false} onPress={() => setMode(item)} style={[styles.tab, mode === item && styles.activeTab, radio.config?.flags[item] === false && { opacity: 0.35 }]}>
                    <Text style={[styles.tabText, { color: mode === item ? '#071510' : theme.text }]}>{item === 'global' ? 'Globalne' : item === 'city' ? 'Miasto' : 'Prywatne'}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {mode === 'global' && (
                <View style={styles.modeContent}>
                  <Text style={[styles.sectionTitle, { color: theme.text }]}>Promień odbioru: {Math.round(radiusKm)} km</Text>
                  <Slider minimumValue={1} maximumValue={100} step={1} value={radiusKm} onValueChange={setRadiusKm} minimumTrackTintColor="#18D7A0" maximumTrackTintColor={theme.border2} thumbTintColor="#18D7A0" />
                  <View style={styles.rangeLabels}><Text style={styles.help}>1 km</Text><Text style={styles.help}>100 km</Text></View>
                  <Text style={styles.explainer}>Usłyszysz wyłącznie osoby, których promień również obejmuje Ciebie. Lokalizacja nie jest pokazywana innym.</Text>
                </View>
              )}

              {mode === 'city' && (
                <View style={styles.modeContent}>
                  <TextInput value={cityQuery} onChangeText={setCityQuery} placeholder="Wyszukaj polskie miasto" placeholderTextColor="#7D8993" style={[styles.search, { color: theme.text, borderColor: theme.border2, backgroundColor: theme.surface2 }]} />
                  <FlatList
                    data={cities}
                    keyboardShouldPersistTaps="handled"
                    keyExtractor={(item) => item.slug}
                    style={{ maxHeight: 230 }}
                    renderItem={({ item }) => <TouchableOpacity onPress={() => { setSelectedCity(item); setCityQuery(item.name); }} style={[styles.city, selectedCity?.slug === item.slug && styles.selectedCity]}><Text style={[styles.personName, { color: theme.text }]}>{item.name}</Text><Text style={styles.help}>{item.voivodeship || 'Polska'}</Text></TouchableOpacity>}
                  />
                  <Text style={styles.explainer}>Możesz wejść na kanał miasta z dowolnego miejsca. Pozycje uczestników pozostają ukryte.</Text>
                </View>
              )}

              {mode === 'private' && (
                <View style={styles.modeContent}>
                  {activeConvoy ? <View style={[styles.privateCard, { backgroundColor: theme.surface2 }]}><MaterialCommunityIcons name="car-multiple" size={27} color="#FFD447" /><View style={{ flex: 1 }}><Text style={[styles.channelName, { color: theme.text }]}>{activeConvoy.convoy.name}</Text><Text style={styles.help}>{activeConvoy.participants.length}/50 · pozycje na obecnej mapie</Text></View></View> : <Text style={styles.explainer}>Nie masz aktywnego Convoy Live. Utwórz go lub dołącz kodem, linkiem albo zaproszeniem.</Text>}
                </View>
              )}

              <TouchableOpacity disabled={busy || !radio.config?.voiceConfigured} onPress={() => { void connect(); }} style={[styles.connectButton, (busy || !radio.config?.voiceConfigured) && { opacity: 0.45 }]}>
                {busy ? <ActivityIndicator color="#071510" /> : <MaterialCommunityIcons name="radio-handheld" size={23} color="#071510" />}
                <Text style={styles.connectText}>DOŁĄCZ DO KANAŁU</Text>
              </TouchableOpacity>
              <Text style={[styles.help, { textAlign: 'center', marginTop: 10 }]}>Jednocześnie aktywny może być tylko jeden kanał audio.</Text>
            </View>
          )}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  mapButton: { position: 'absolute', right: 12, zIndex: 31, minHeight: 48, maxWidth: 238, paddingLeft: 10, paddingRight: 6, borderRadius: 15, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 7, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 6 },
  radioDot: { width: 7, height: 7, borderRadius: 4 },
  mapButtonCopy: { flexShrink: 1, minWidth: 72 },
  mapButtonTitle: { fontSize: 12, fontWeight: '900', letterSpacing: 0.2 },
  mapButtonMeta: { color: '#18D7A0', fontSize: 10, marginTop: 1 },
  miniPtt: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#18D7A0' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: '#00000088' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '76%', borderTopLeftRadius: 25, borderTopRightRadius: 25, borderWidth: 1, paddingHorizontal: 18, paddingBottom: 28 },
  handle: { alignSelf: 'center', width: 45, height: 4, borderRadius: 2, backgroundColor: '#71808B', marginTop: 9, marginBottom: 14 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  kicker: { fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
  title: { fontSize: 25, fontWeight: '900' },
  close: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  error: { color: '#FF6969', backgroundColor: '#FF696914', borderRadius: 10, padding: 9, marginBottom: 10 },
  warning: { color: '#FFB64D', backgroundColor: '#FFB64D14', borderRadius: 10, padding: 9, marginBottom: 10 },
  tabs: { flexDirection: 'row', padding: 4, borderRadius: 14, marginBottom: 17 },
  tab: { flex: 1, minHeight: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  activeTab: { backgroundColor: '#18D7A0' },
  tabText: { fontSize: 12, fontWeight: '900' },
  modeContent: { flex: 1 },
  sectionTitle: { fontSize: 14, fontWeight: '900', marginBottom: 8 },
  rangeLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  help: { color: '#84919B', fontSize: 11, lineHeight: 15 },
  explainer: { color: '#92A0AA', fontSize: 13, lineHeight: 19, marginTop: 16 },
  search: { height: 48, borderWidth: 1, borderRadius: 13, paddingHorizontal: 14, fontSize: 14, marginBottom: 8 },
  city: { paddingVertical: 10, paddingHorizontal: 11, borderRadius: 10 },
  selectedCity: { backgroundColor: '#18D7A022' },
  connectButton: { minHeight: 52, borderRadius: 15, backgroundColor: '#18D7A0', flexDirection: 'row', gap: 9, alignItems: 'center', justifyContent: 'center', marginTop: 'auto' },
  connectText: { color: '#071510', fontWeight: '900', fontSize: 13 },
  privateCard: { flexDirection: 'row', gap: 11, alignItems: 'center', borderRadius: 14, padding: 14 },
  channelName: { fontSize: 15, fontWeight: '900' },
  connectedContent: { paddingBottom: 30, gap: 14 },
  channelCard: { borderWidth: 1, borderRadius: 15, padding: 13 },
  channelRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  channelMeta: { color: '#84919B', fontSize: 11, marginTop: 2 },
  leaveButton: { borderRadius: 9, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#EF535322' },
  leaveText: { color: '#EF6D6D', fontSize: 10, fontWeight: '900' },
  vadRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 13 },
  ptt: { minHeight: 76, borderRadius: 20, backgroundColor: '#18D7A0', flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center' },
  pttActive: { backgroundColor: '#FFD447', transform: [{ scale: 0.98 }] },
  pttText: { color: '#06140F', fontSize: 13, fontWeight: '900' },
  person: { flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 9 },
  personName: { fontSize: 13, fontWeight: '800' },
  personMeta: { color: '#18D7A0', fontSize: 9, fontWeight: '800', marginTop: 2, textTransform: 'uppercase' },
  speaking: { width: 31, height: 31, borderRadius: 10, backgroundColor: '#18D7A018', alignItems: 'center', justifyContent: 'center' },
  pendingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  allow: { backgroundColor: '#18D7A022', borderRadius: 9, paddingHorizontal: 10, paddingVertical: 7 },
  allowText: { color: '#18D7A0', fontSize: 10, fontWeight: '900' },
});
