import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Switch, TouchableOpacity, View } from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from '../../../../components/ui/AppText';
import Toast from 'react-native-toast-message';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_URL } from '../../../../constants/config';
import { useTheme } from '../../../../contexts/ThemeContext';
import { getAuthToken } from '../../../../lib/getAuthToken';

type Tab = 'rsvp' | 'checkin' | 'staff' | 'notify' | 'edit';
const showToast = (params: any) => Toast.show(params);

async function authFetch(path: string, init: RequestInit = {}) {
  const token = await getAuthToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Operacja nie powiodła się');
  return data;
}

export default function PartnerEventManageScreen() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const id = Number(eventId);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useTheme();
  const [tab, setTab] = useState<Tab>('rsvp');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [staff, setStaff] = useState<any[]>([]);
  const [qrToken, setQrToken] = useState('');
  const [username, setUsername] = useState('');
  const [staffRole, setStaffRole] = useState('scanner');
  const [notifyBody, setNotifyBody] = useState('');
  const [capacity, setCapacity] = useState('');
  const [locationName, setLocationName] = useState('');
  const [allowCheckIn, setAllowCheckIn] = useState(false);
  const [busy, setBusy] = useState(false);

  const card = isDark ? '#12161a' : '#f5f6f7';
  const border = isDark ? '#262d34' : '#e1e4e7';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const manage = await authFetch(`/api/partner-events/${id}/manage`);
      setData(manage);
      setCapacity(manage.event?.capacity != null ? String(manage.event.capacity) : '');
      setLocationName(manage.event?.locationName || '');
      setAllowCheckIn(Boolean(manage.event?.allowCheckIn));
      if (manage.permissions?.staff || manage.role === 'owner' || manage.role === 'editor' || manage.role === 'scanner') {
        const staffList = await authFetch(`/api/partner-events/${id}/staff`);
        setStaff(Array.isArray(staffList) ? staffList : []);
      }
    } catch (error: any) {
      showToast({ type: 'error', text1: 'Błąd', text2: error.message });
      router.back();
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    if (Number.isFinite(id)) void load();
  }, [id, load]);

  const doCheckIn = async () => {
    if (!qrToken.trim()) return showToast({ type: 'error', text1: 'Wklej kod QR uczestnika' });
    setBusy(true);
    try {
      const result = await authFetch(`/api/partner-events/${id}/check-in`, {
        method: 'POST',
        body: JSON.stringify({ qrToken: qrToken.trim() }),
      });
      showToast({
        type: 'success',
        text1: result.alreadyCheckedIn ? 'Już check-in' : 'Check-in OK',
        text2: result.registration?.user?.username || '',
      });
      setQrToken('');
      await load();
    } catch (error: any) {
      showToast({ type: 'error', text1: 'Check-in', text2: error.message });
    } finally {
      setBusy(false);
    }
  };

  const addStaff = async () => {
    if (!username.trim()) return showToast({ type: 'error', text1: 'Podaj username' });
    setBusy(true);
    try {
      await authFetch(`/api/partner-events/${id}/staff`, {
        method: 'POST',
        body: JSON.stringify({ username: username.trim(), role: staffRole }),
      });
      setUsername('');
      showToast({ type: 'success', text1: 'Dodano staff' });
      await load();
    } catch (error: any) {
      showToast({ type: 'error', text1: 'Staff', text2: error.message });
    } finally {
      setBusy(false);
    }
  };

  const removeStaff = async (userId: number) => {
    setBusy(true);
    try {
      await authFetch(`/api/partner-events/${id}/staff/${userId}`, { method: 'DELETE' });
      showToast({ type: 'success', text1: 'Usunięto staff' });
      await load();
    } catch (error: any) {
      showToast({ type: 'error', text1: 'Staff', text2: error.message });
    } finally {
      setBusy(false);
    }
  };

  const sendNotify = async () => {
    if (!notifyBody.trim()) return showToast({ type: 'error', text1: 'Podaj treść' });
    setBusy(true);
    try {
      const result = await authFetch(`/api/partner-events/${id}/notify`, {
        method: 'POST',
        body: JSON.stringify({ body: notifyBody.trim() }),
      });
      setNotifyBody('');
      showToast({ type: 'success', text1: 'Wysłano', text2: `${result.sent || 0} powiadomień` });
    } catch (error: any) {
      showToast({ type: 'error', text1: 'Powiadomienia', text2: error.message });
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    setBusy(true);
    try {
      await authFetch(`/api/partner-events/${id}/manage`, {
        method: 'PATCH',
        body: JSON.stringify({
          capacity: capacity.trim() ? Number(capacity) : null,
          locationName,
          allowCheckIn,
        }),
      });
      showToast({ type: 'success', text1: 'Zapisano' });
      await load();
    } catch (error: any) {
      showToast({ type: 'error', text1: 'Edycja', text2: error.message });
    } finally {
      setBusy(false);
    }
  };

  if (loading || !data) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#ff3b3f" />
      </View>
    );
  }

  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: 'rsvp', label: 'RSVP', show: true },
    { id: 'checkin', label: 'Check-in', show: data.permissions?.checkIn },
    { id: 'staff', label: 'Staff', show: data.permissions?.staff },
    { id: 'notify', label: 'Push', show: data.permissions?.notify },
    { id: 'edit', label: 'Edycja', show: data.permissions?.edit },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: border, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <TouchableOpacity onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: card, alignItems: 'center', justifyContent: 'center' }}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={theme.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#ff3b3f', fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 1 }}>ZARZĄDZANIE</Text>
          <Text style={{ color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 14, marginTop: 3 }} numberOfLines={1}>{data.event?.title}</Text>
        </View>
        <Text style={{ color: theme.textDim, fontSize: 12, fontWeight: '800' }}>{String(data.role || '').toUpperCase()}</Text>
      </View>

      <View style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7 }}>
          {tabs.filter((item) => item.show).map((item) => (
            <TouchableOpacity
              key={item.id}
              onPress={() => setTab(item.id)}
              style={{
                paddingHorizontal: 13, height: 36, borderRadius: 10, borderWidth: 1,
                borderColor: tab === item.id ? '#ff3b3f' : border,
                backgroundColor: tab === item.id ? '#ff3b3f22' : card,
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: tab === item.id ? theme.text : theme.textDim, fontWeight: '800', fontSize: 12 }}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 12 }}>
        <View style={{ padding: 14, borderRadius: 14, borderWidth: 1, borderColor: border, backgroundColor: card, flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ color: theme.textDim }}>Zapisani</Text>
          <Text style={{ color: theme.text, fontWeight: '800' }}>{data.counts?.total || 0}</Text>
          <Text style={{ color: theme.textDim }}>Check-in</Text>
          <Text style={{ color: '#43d17b', fontWeight: '800' }}>{data.counts?.checkedIn || 0}</Text>
        </View>

        {tab === 'rsvp' && (data.registrations?.length
          ? data.registrations.map((row: any) => (
            <View key={row.id} style={{ padding: 14, borderRadius: 14, borderWidth: 1, borderColor: border, backgroundColor: card, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View>
                <Text style={{ color: theme.text, fontWeight: '800' }}>@{row.user?.username}</Text>
                <Text style={{ color: theme.textDim, marginTop: 4, fontSize: 12 }}>{new Date(row.createdAt).toLocaleString('pl-PL')}</Text>
              </View>
              <Text style={{ color: row.status === 'checked_in' ? '#43d17b' : theme.textDim, fontWeight: '800', fontSize: 12 }}>
                {row.status === 'checked_in' ? 'CHECKED-IN' : 'RSVP'}
              </Text>
            </View>
          ))
          : <Text style={{ color: theme.textDim, textAlign: 'center', marginTop: 24 }}>Brak zapisanych uczestników.</Text>)}

        {tab === 'checkin' && (
          <View style={{ gap: 12 }}>
            <Text style={{ color: theme.textDim }}>Wklej lub zeskanuj token QR uczestnika (EVT-…).</Text>
            <TextInput
              value={qrToken}
              onChangeText={setQrToken}
              autoCapitalize="characters"
              placeholder="EVT-..."
              placeholderTextColor="#66717d"
              style={{ color: theme.text, borderWidth: 1, borderColor: border, backgroundColor: card, borderRadius: 12, padding: 14 }}
            />
            <TouchableOpacity disabled={busy} onPress={doCheckIn} style={{ padding: 15, borderRadius: 13, backgroundColor: '#ff3b3f', alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
              <Text style={{ color: '#fff', fontWeight: '900' }}>ZATWIERDŹ CHECK-IN</Text>
            </TouchableOpacity>
          </View>
        )}

        {tab === 'staff' && (
          <View style={{ gap: 12 }}>
            <TextInput
              value={username}
              onChangeText={setUsername}
              placeholder="@username"
              placeholderTextColor="#66717d"
              autoCapitalize="none"
              style={{ color: theme.text, borderWidth: 1, borderColor: border, backgroundColor: card, borderRadius: 12, padding: 14 }}
            />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['scanner', 'editor'] as const).map((role) => (
                <TouchableOpacity
                  key={role}
                  onPress={() => setStaffRole(role)}
                  style={{
                    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1,
                    borderColor: staffRole === role ? '#ff3b3f' : border,
                    backgroundColor: staffRole === role ? '#ff3b3f22' : card,
                  }}
                >
                  <Text style={{ color: theme.text, fontWeight: '800', fontSize: 12 }}>{role}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity disabled={busy} onPress={addStaff} style={{ padding: 14, borderRadius: 12, backgroundColor: '#ff3b3f', alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '900' }}>DODAJ</Text>
            </TouchableOpacity>
            {staff.map((row) => (
              <View key={row.id} style={{ padding: 14, borderRadius: 14, borderWidth: 1, borderColor: border, backgroundColor: card, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontWeight: '800' }}>@{row.user?.username}</Text>
                  <Text style={{ color: theme.textDim, marginTop: 3, fontSize: 12 }}>{row.role}</Text>
                </View>
                {row.role !== 'owner' && (
                  <TouchableOpacity onPress={() => removeStaff(row.userId)}>
                    <MaterialCommunityIcons name="trash-can-outline" size={20} color="#ff6b72" />
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        )}

        {tab === 'notify' && (
          <View style={{ gap: 12 }}>
            <Text style={{ color: theme.textDim }}>Powiadomienie trafi do wszystkich zapisanych uczestników.</Text>
            <TextInput
              value={notifyBody}
              onChangeText={setNotifyBody}
              placeholder="Treść aktualizacji…"
              placeholderTextColor="#66717d"
              multiline
              style={{ minHeight: 110, color: theme.text, borderWidth: 1, borderColor: border, backgroundColor: card, borderRadius: 12, padding: 14, textAlignVertical: 'top' }}
            />
            <TouchableOpacity disabled={busy} onPress={sendNotify} style={{ padding: 15, borderRadius: 13, backgroundColor: '#ff3b3f', alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '900' }}>WYŚLIJ POWIADOMIENIE</Text>
            </TouchableOpacity>
          </View>
        )}

        {tab === 'edit' && (
          <View style={{ gap: 12 }}>
            <Text style={{ color: theme.textDim }}>Pola operacyjne (bez republish / zmiany treści marketingowej).</Text>
            <TextInput
              value={locationName}
              onChangeText={setLocationName}
              placeholder="Miejsce"
              placeholderTextColor="#66717d"
              style={{ color: theme.text, borderWidth: 1, borderColor: border, backgroundColor: card, borderRadius: 12, padding: 14 }}
            />
            <TextInput
              value={capacity}
              onChangeText={setCapacity}
              placeholder="Limit miejsc"
              keyboardType="number-pad"
              placeholderTextColor="#66717d"
              style={{ color: theme.text, borderWidth: 1, borderColor: border, backgroundColor: card, borderRadius: 12, padding: 14 }}
            />
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: border, backgroundColor: card }}>
              <Text style={{ color: theme.text, fontWeight: '700' }}>Check-in QR</Text>
              <Switch value={allowCheckIn} onValueChange={setAllowCheckIn} />
            </View>
            <TouchableOpacity disabled={busy} onPress={saveEdit} style={{ padding: 15, borderRadius: 13, backgroundColor: '#ff3b3f', alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '900' }}>ZAPISZ</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
