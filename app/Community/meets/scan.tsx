import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal, ActivityIndicator, StatusBar, Image,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../../contexts/ThemeContext';
import { API_URL } from '../../../constants/config';
import { CommunityScreenHeader } from '../../../components/community';

type CameraModule = {
  CameraView: React.ComponentType<any>;
  useCameraPermissions: () => [
    { granted: boolean; canAskAgain: boolean } | null,
    () => Promise<{ granted: boolean }>,
  ];
};

function loadCameraModule(): CameraModule | null {
  try {
    return require('expo-camera');
  } catch {
    return null;
  }
}

const cameraModule = loadCameraModule();

interface CheckInResult {
  alreadyCheckedIn?: boolean;
  pendingApproval?: boolean;
  user: { id: number; username: string; avatarUrl: string | null };
  car?: { id: number; brand: string; specs: string; photos: string[] } | null;
  joinedAt: string;
  checkedInAt: string | null;
  entryType: string | null;
  checkInKind?: 'visitor' | 'participant';
  isParticipant?: boolean;
  freeEntryGranted?: boolean;
  freeEntryRemaining: number;
  freeParticipantEntryRemaining?: number;
  ticketPrice: number | null;
  ticketCurrency: string;
  checkedInBy?: { id: number; username: string } | null;
}

function formatDt(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pl-PL', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function parseQrRaw(data: string): { qrPayload: string; preferPreview: boolean } | null {
  const raw = String(data || '').trim();
  if (raw.startsWith('vroom://meet-participant')) {
    return { qrPayload: raw, preferPreview: true };
  }
  if (raw.startsWith('vroom://meet-checkin')) {
    return { qrPayload: raw, preferPreview: false };
  }
  if (/^[a-f0-9]{64}$/i.test(raw)) {
    return { qrPayload: raw, preferPreview: true };
  }
  return null;
}

export default function MeetScanScreen() {
  if (!cameraModule) {
    return <CameraUnavailable />;
  }
  return <MeetScanCamera camera={cameraModule} />;
}

function CameraUnavailable() {
  const router = useRouter();
  const { theme } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, padding: 24, justifyContent: 'center', gap: 16 }}>
      <CommunityScreenHeader title="SKANUJ BILET" subtitle="Wymagany rebuild aplikacji" />
      <MaterialIcons name="camera-alt" size={48} color={theme.textDim} style={{ alignSelf: 'center' }} />
      <Text style={{ color: theme.text, textAlign: 'center', lineHeight: 22, fontSize: 14 }}>
        Moduł aparatu nie jest dostępny w tej wersji dev clienta.
      </Text>
      <TouchableOpacity
        onPress={() => router.back()}
        style={{ backgroundColor: theme.primary, borderRadius: 14, paddingVertical: 16, alignItems: 'center' }}
      >
        <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 12, fontWeight: '700' }}>WRÓĆ</Text>
      </TouchableOpacity>
    </View>
  );
}

function MeetScanCamera({ camera }: { camera: CameraModule }) {
  const { CameraView, useCameraPermissions } = camera;
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [scannedPayload, setScannedPayload] = useState<string | null>(null);
  const [freeEntryRemaining, setFreeEntryRemaining] = useState(0);
  const [freeEntryQuota, setFreeEntryQuota] = useState(0);
  const [freeParticipantRemaining, setFreeParticipantRemaining] = useState(0);
  const [freeParticipantQuota, setFreeParticipantQuota] = useState(0);
  const lastScanRef = useRef('');

  const getToken = async () =>
    (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token')) ?? '';

  const loadMeetStats = useCallback(async () => {
    try {
      const token = await getToken();
      const r = await fetch(`${API_URL}/api/meets/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      if (r.ok) {
        setFreeEntryRemaining(data.freeEntryRemaining ?? 0);
        setFreeEntryQuota(data.freeEntryQuota ?? 0);
        setFreeParticipantRemaining(data.freeParticipantEntryRemaining ?? 0);
        setFreeParticipantQuota(data.freeParticipantEntryQuota ?? 0);
      }
    } catch { /* ignore */ }
  }, [id]);

  useEffect(() => { loadMeetStats(); }, [loadMeetStats]);

  useEffect(() => {
    if (!permission?.granted && permission?.canAskAgain) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  const postCheckin = useCallback(async (qrPayload: string, action: 'preview' | 'confirm') => {
    const authToken = await getToken();
    return fetch(`${API_URL}/api/meets/${id}/checkin`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ qrPayload, action }),
    });
  }, [id]);

  const applyCheckInResult = useCallback((data: any, status: number, qrPayload: string) => {
    const isParticipant = data.checkInKind === 'participant' || data.isParticipant;
    setResult({ ...data, alreadyCheckedIn: status === 409 });

    if (data.pendingApproval) {
      setScannedPayload(qrPayload);
      return;
    }

    setScannedPayload(null);
    if (!isParticipant && data.freeEntryRemaining != null) {
      setFreeEntryRemaining(data.freeEntryRemaining);
    }
    if (isParticipant && data.freeParticipantEntryRemaining != null) {
      setFreeParticipantRemaining(data.freeParticipantEntryRemaining);
    }
  }, []);

  const submitCheckIn = useCallback(async (qrRaw: string) => {
    const parsed = parseQrRaw(qrRaw);
    if (!parsed || submitting) return;
    if (lastScanRef.current === parsed.qrPayload) return;
    lastScanRef.current = parsed.qrPayload;
    setSubmitting(true);
    setScanning(false);

    try {
      if (parsed.preferPreview) {
        let r = await postCheckin(parsed.qrPayload, 'preview');
        let data = await r.json();

        if (!r.ok && r.status === 400) {
          r = await postCheckin(parsed.qrPayload, 'confirm');
          data = await r.json();
          if (!r.ok && r.status !== 409) {
            Toast.show({ type: 'error', text1: 'BŁĄD', text2: data.error || 'Skan nieudany' });
            setScanning(true);
            lastScanRef.current = '';
            return;
          }
          applyCheckInResult(data, r.status, parsed.qrPayload);
          return;
        }

        if (!r.ok && r.status !== 409) {
          Toast.show({ type: 'error', text1: 'BŁĄD', text2: data.error || 'Skan nieudany' });
          setScanning(true);
          lastScanRef.current = '';
          return;
        }
        applyCheckInResult(data, r.status, parsed.qrPayload);
        return;
      }

      const r = await postCheckin(parsed.qrPayload, 'confirm');
      const data = await r.json();
      if (!r.ok && r.status !== 409) {
        Toast.show({ type: 'error', text1: 'BŁĄD', text2: data.error || 'Skan nieudany' });
        setScanning(true);
        lastScanRef.current = '';
        return;
      }
      applyCheckInResult(data, r.status, parsed.qrPayload);
    } catch {
      Toast.show({ type: 'error', text1: 'Błąd połączenia' });
      setScanning(true);
      lastScanRef.current = '';
    } finally {
      setSubmitting(false);
    }
  }, [submitting, postCheckin, applyCheckInResult]);

  const confirmParticipant = useCallback(async () => {
    if (!scannedPayload || submitting) return;
    setSubmitting(true);
    try {
      const r = await postCheckin(scannedPayload, 'confirm');
      const data = await r.json();
      if (!r.ok && r.status !== 409) {
        Toast.show({ type: 'error', text1: 'BŁĄD', text2: data.error || 'Nie udało się wpuścić' });
        return;
      }
      applyCheckInResult({ ...data, pendingApproval: false }, r.status, scannedPayload);
      const isFree = data.entryType === 'free_vroom' || data.freeEntryGranted;
      Toast.show({
        type: 'success',
        text1: 'WPUSZCZONO',
        text2: isFree ? 'FREE VROOM przyznany na miejscu' : 'Wjazd standardowy',
      });
    } catch {
      Toast.show({ type: 'error', text1: 'Błąd połączenia' });
    } finally {
      setSubmitting(false);
    }
  }, [scannedPayload, submitting, postCheckin, applyCheckInResult]);

  const rejectParticipant = () => {
    setResult(null);
    setScannedPayload(null);
    lastScanRef.current = '';
    setScanning(true);
  };

  const closeResult = () => {
    setResult(null);
    setScannedPayload(null);
    lastScanRef.current = '';
    setScanning(true);
  };

  const onBarcode = ({ data }: { data: string }) => {
    if (!scanning || submitting) return;
    submitCheckIn(data);
  };

  if (!permission) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, padding: 24, justifyContent: 'center', gap: 16 }}>
        <CommunityScreenHeader title="SKANUJ BILET" subtitle="Wymagany dostęp do aparatu" />
        <TouchableOpacity
          onPress={requestPermission}
          style={{ backgroundColor: theme.primary, borderRadius: 14, paddingVertical: 16, alignItems: 'center' }}
        >
          <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 12, fontWeight: '700' }}>ZEZWÓL NA APARAT</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isParticipant = result?.checkInKind === 'participant' || result?.isParticipant;
  const isPending = !!result?.pendingApproval && !result?.alreadyCheckedIn;
  const isFree = result?.entryType === 'free_vroom' || result?.freeEntryGranted;
  const carPhoto = result?.car?.photos?.[0];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle="light-content" />
      <CommunityScreenHeader title="SKANUJ BILET" subtitle="Gość lub uczestnik z autem" />

      <View style={{ marginHorizontal: 16, marginBottom: 8, gap: 8 }}>
        {freeEntryQuota > 0 && (
          <View style={{ backgroundColor: theme.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: theme.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9, letterSpacing: 1 }}>FREE GOŚCIE</Text>
            <Text style={{ color: freeEntryRemaining > 0 ? '#f5c518' : theme.textDim, fontFamily: 'Orbitron', fontSize: 16, fontWeight: '700' }}>
              {freeEntryRemaining} / {freeEntryQuota}
            </Text>
          </View>
        )}
        {freeParticipantQuota > 0 && (
          <View style={{ backgroundColor: theme.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: theme.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9, letterSpacing: 1 }}>FREE UCZESTNICY Z AUTEM</Text>
            <Text style={{ color: freeParticipantRemaining > 0 ? '#4de926' : theme.textDim, fontFamily: 'Orbitron', fontSize: 16, fontWeight: '700' }}>
              {freeParticipantRemaining} / {freeParticipantQuota}
            </Text>
          </View>
        )}
      </View>

      <View style={{ flex: 1, margin: 16, marginTop: 0, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: theme.border }}>
        {scanning && (
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={onBarcode}
          />
        )}
        {!scanning && !result && (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surface }}>
            <ActivityIndicator size="large" color={theme.primary} />
          </View>
        )}
      </View>

      <Modal visible={!!result} animationType="slide" transparent onRequestClose={isPending ? rejectParticipant : closeResult}>
        <View style={{ flex: 1, backgroundColor: theme.overlay, justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: theme.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 16 }}>
            {result && (
              <>
                <View style={{ alignItems: 'center', gap: 10 }}>
                  <View style={{ width: 64, height: 64, borderRadius: 32, overflow: 'hidden', backgroundColor: theme.primaryBg, borderWidth: 2, borderColor: isParticipant ? '#4de92650' : theme.primaryBorder, alignItems: 'center', justifyContent: 'center' }}>
                    {result.user.avatarUrl
                      ? <Image source={{ uri: result.user.avatarUrl }} style={{ width: '100%', height: '100%' }} />
                      : <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 22, fontWeight: '700' }}>{result.user.username.charAt(0).toUpperCase()}</Text>
                    }
                  </View>
                  <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 16, fontWeight: '700' }}>@{result.user.username}</Text>
                  <View style={{ backgroundColor: isParticipant ? '#4de92620' : theme.primaryBg, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: isParticipant ? '#4de92650' : theme.primaryBorder }}>
                    <Text style={{ color: isParticipant ? '#4de926' : theme.primary, fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700' }}>
                      {isParticipant ? 'UCZESTNIK Z AUTEM' : 'GOŚĆ / UŻYTKOWNIK'}
                    </Text>
                  </View>
                  {isPending && (
                    <Text style={{ color: theme.textDim, fontSize: 12, textAlign: 'center', lineHeight: 18 }}>
                      Zatwierdź wjazd na miejsce lub odrzuć — możesz zeskanować ponownie później.
                    </Text>
                  )}
                  {result.alreadyCheckedIn && (
                    <View style={{ backgroundColor: '#ff980020', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: '#ff980050' }}>
                      <Text style={{ color: '#ff9800', fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700' }}>JUŻ ZESKANOWANY</Text>
                    </View>
                  )}
                </View>

                {result.car && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: theme.border }}>
                    <View style={{ width: 56, height: 42, borderRadius: 8, overflow: 'hidden', backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
                      {carPhoto
                        ? <Image source={{ uri: carPhoto }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                        : <MaterialCommunityIcons name="car-sports" size={22} color={theme.textDim} />
                      }
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 8, letterSpacing: 1 }}>AUTO</Text>
                      <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 11, fontWeight: '700' }}>
                        {result.car.brand} {result.car.specs}
                      </Text>
                    </View>
                  </View>
                )}

                <InfoRow theme={theme} label="Dołączył w apce" value={formatDt(result.joinedAt)} />

                {isPending && isParticipant && (
                  <InfoRow
                    theme={theme}
                    label="Dostępne free (uczestnicy)"
                    value={`${freeParticipantRemaining} / ${freeParticipantQuota}`}
                    accent="#4de926"
                  />
                )}

                {!isPending && (
                  <>
                    <InfoRow theme={theme} label="Check-in" value={formatDt(result.checkedInAt)} />
                    <InfoRow
                      theme={theme}
                      label="Wjazd VROOM FREE"
                      value={isFree ? 'TAK — wjazd gratis' : 'NIE — standardowy bilet'}
                      accent={isFree ? '#4de926' : theme.textDim}
                    />
                  </>
                )}

                {isPending ? (
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                    <TouchableOpacity
                      onPress={rejectParticipant}
                      disabled={submitting}
                      style={{ flex: 1, backgroundColor: '#e3383515', borderRadius: 14, paddingVertical: 16, alignItems: 'center', borderWidth: 1, borderColor: '#e3383540' }}
                    >
                      <Text style={{ color: '#e33835', fontFamily: 'Orbitron', fontSize: 11, fontWeight: '700' }}>ODRZUĆ</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={confirmParticipant}
                      disabled={submitting}
                      style={{ flex: 1, backgroundColor: theme.primary, borderRadius: 14, paddingVertical: 16, alignItems: 'center', opacity: submitting ? 0.7 : 1 }}
                    >
                      {submitting
                        ? <ActivityIndicator color="#fff" size="small" />
                        : <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 11, fontWeight: '700' }}>ZATWIERDŹ WJAZD</Text>
                      }
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    onPress={closeResult}
                    style={{ backgroundColor: theme.primary, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 }}
                  >
                    <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 12, fontWeight: '700' }}>SKANUJ KOLEJNY</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function InfoRow({ label, value, theme, accent }: { label: string; value: string; theme: any; accent?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, backgroundColor: theme.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: theme.border }}>
      <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9, letterSpacing: 1 }}>{label}</Text>
      <Text style={{ color: accent || theme.text, fontFamily: 'Orbitron', fontSize: 11, fontWeight: '700', textAlign: 'right', flex: 1 }}>{value}</Text>
    </View>
  );
}
