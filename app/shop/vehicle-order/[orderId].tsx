import React, { useCallback, useEffect, useState } from 'react';
import { View, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Image } from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from '../../../components/ui/AppText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../../contexts/ThemeContext';
import { API_URL } from '../../../constants/config';

const STATUS_LABELS: Record<string, string> = {
  awaiting_details: 'Oczekuje danych',
  in_production: 'W produkcji',
  ready: 'Gotowy',
  rejected: 'Odrzucony',
};

type OrderDetail = {
  id: string;
  status: string;
  carMake?: string | null;
  carModel?: string | null;
  carYear?: number | null;
  carColor?: string | null;
  description?: string | null;
  photoUrls?: string[];
  shopItem?: { name: string } | null;
  resultingItem?: { id: string; name: string } | null;
};

async function getToken() {
  return (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
}

export default function VehicleOrderDetailScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { theme } = useTheme();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [carMake, setCarMake] = useState('');
  const [carModel, setCarModel] = useState('');
  const [carYear, setCarYear] = useState('');
  const [carColor, setCarColor] = useState('');
  const [description, setDescription] = useState('');
  const [localPhotos, setLocalPhotos] = useState<string[]>([]);

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token || !orderId) return;
    try {
      const res = await fetch(`${API_URL}/api/vehicle-orders/${orderId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      const o = data?.order as OrderDetail;
      setOrder(o);
      setCarMake(o?.carMake ?? '');
      setCarModel(o?.carModel ?? '');
      setCarYear(o?.carYear != null ? String(o.carYear) : '');
      setCarColor(o?.carColor ?? '');
      setDescription(o?.description ?? '');
      setLocalPhotos(Array.isArray(o?.photoUrls) ? o.photoUrls : []);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => { void load(); }, [load]);

  const pickPhotos = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: 8 - localPhotos.length,
      quality: 0.85,
    });
    if (result.canceled) return;
    setLocalPhotos((prev) => [
      ...prev,
      ...result.assets.map((a) => a.uri).filter(Boolean),
    ].slice(0, 8));
  };

  const submit = async () => {
    const token = await getToken();
    if (!token || !orderId) return;
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('carMake', carMake.trim());
      fd.append('carModel', carModel.trim());
      fd.append('carYear', carYear.trim());
      fd.append('carColor', carColor.trim());
      fd.append('description', description.trim());
      for (const uri of localPhotos) {
        if (uri.startsWith('http')) continue;
        const name = uri.split('/').pop() ?? 'photo.jpg';
        fd.append('photos', { uri, name, type: 'image/jpeg' } as unknown as Blob);
      }
      const res = await fetch(`${API_URL}/api/vehicle-orders/${orderId}/details`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        Toast.show({ type: 'error', text1: data?.error ?? 'Błąd zapisu' });
        return;
      }
      Toast.show({ type: 'success', text1: 'Wysłano!', text2: 'Przygotujemy Twój model 3D' });
      await load();
    } finally {
      setSaving(false);
    }
  };

  const canEdit = order && ['awaiting_details', 'in_production'].includes(order.status);

  return (
    <View style={[styles.root, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: theme.text }]}>Zamówienie pojazdu</Text>
      </View>
      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color="#e33835" />
      ) : !order ? (
        <Text style={{ color: theme.textDim, textAlign: 'center', marginTop: 40 }}>Nie znaleziono</Text>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}>
          <View style={[styles.statusCard, { backgroundColor: theme.surface2 }]}>
            <Text style={{ color: theme.textDim, fontSize: 12 }}>Status</Text>
            <Text style={{ color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 15 }}>
              {STATUS_LABELS[order.status] ?? order.status}
            </Text>
            {order.status === 'ready' && order.resultingItem && (
              <TouchableOpacity style={styles.readyBtn} onPress={() => router.push('/shop')}>
                <Text style={styles.readyBtnText}>Załóż model w sklepie</Text>
              </TouchableOpacity>
            )}
          </View>

          {canEdit ? (
            <>
              <Text style={[styles.label, { color: theme.textDim }]}>Opisz swoje auto</Text>
              {(['carMake', 'carModel', 'carYear', 'carColor'] as const).map((field, i) => {
                const labels = ['Marka', 'Model', 'Rok', 'Kolor'];
                const values = [carMake, carModel, carYear, carColor];
                const setters = [setCarMake, setCarModel, setCarYear, setCarColor];
                return (
                  <TextInput
                    key={field}
                    style={[styles.input, { color: theme.text, borderColor: theme.border2, backgroundColor: theme.surface }]}
                    placeholder={labels[i]}
                    placeholderTextColor={theme.textMuted}
                    value={values[i]}
                    onChangeText={setters[i]}
                  />
                );
              })}
              <TextInput
                style={[styles.input, styles.textArea, { color: theme.text, borderColor: theme.border2, backgroundColor: theme.surface }]}
                placeholder="Dodatkowy opis (modyfikacje, felgi, wykończenie...)"
                placeholderTextColor={theme.textMuted}
                multiline
                value={description}
                onChangeText={setDescription}
              />
              <TouchableOpacity style={styles.photoBtn} onPress={pickPhotos}>
                <MaterialIcons name="add-a-photo" size={20} color="#e33835" />
                <Text style={{ color: theme.text }}>Dodaj zdjęcia ({localPhotos.length}/8)</Text>
              </TouchableOpacity>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                {localPhotos.map((uri) => (
                  <Image key={uri} source={{ uri }} style={styles.thumb} />
                ))}
              </ScrollView>
              <TouchableOpacity style={styles.submitBtn} onPress={submit} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : (
                  <Text style={styles.submitText}>Wyślij dane</Text>
                )}
              </TouchableOpacity>
            </>
          ) : (
            <View style={{ marginTop: 12 }}>
              <Text style={{ color: theme.text }}>{[order.carMake, order.carModel, order.carYear].filter(Boolean).join(' ')}</Text>
              {order.description ? <Text style={{ color: theme.textDim, marginTop: 8 }}>{order.description}</Text> : null}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontFamily: 'Manrope_600SemiBold', fontSize: 16, fontWeight: '700' },
  statusCard: { borderRadius: 12, padding: 14, marginBottom: 16 },
  label: { fontSize: 12, marginBottom: 8, letterSpacing: 0.5 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 10, fontSize: 15 },
  textArea: { minHeight: 100, textAlignVertical: 'top' },
  photoBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  thumb: { width: 72, height: 72, borderRadius: 8, marginRight: 8 },
  submitBtn: { backgroundColor: '#e33835', borderRadius: 12, padding: 16, alignItems: 'center' },
  submitText: { color: '#fff', fontFamily: 'Manrope_600SemiBold', fontWeight: '700' },
  readyBtn: { marginTop: 12, backgroundColor: '#4ade80', borderRadius: 8, padding: 10, alignItems: 'center' },
  readyBtnText: { color: '#111', fontWeight: '700' },
});
