import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Modal, Pressable, RefreshControl,
} from 'react-native';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../contexts/ThemeContext';
import { API_URL } from '../../constants/config';
import { useEffectivePremium } from '../../hooks/useEffectivePremium';

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

type MaintenanceCategory = 'service' | 'technical_review' | 'insurance';

type MaintenanceEntry = {
  id: number;
  category: MaintenanceCategory;
  title: string;
  description: string | null;
  performedAt: string;
  expiresAt: string | null;
  mileage: number | null;
  cost: number | null;
};

type MaintenanceSummary = {
  technicalReviewExpiresAt: string | null;
  insuranceExpiresAt: string | null;
};

const MAINTENANCE_AUTO_EXPIRY_YEARS = 1;

const CATEGORIES: { id: MaintenanceCategory; label: string; icon: string }[] = [
  { id: 'service',           label: 'Serwis / naprawa',      icon: 'build' },
  { id: 'technical_review',  label: 'Przegląd techniczny',   icon: 'fact-check' },
  { id: 'insurance',         label: 'Ubezpieczenie OC',      icon: 'verified-user' },
];

function categoryUsesAutoExpiry(cat: MaintenanceCategory) {
  return cat === 'technical_review' || cat === 'insurance';
}

function addYearsToIso(iso: string, years: number) {
  const d = new Date(iso);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString();
}

function computeExpiryIso(category: MaintenanceCategory, performedIso: string): string | null {
  if (!categoryUsesAutoExpiry(category)) return null;
  return addYearsToIso(performedIso, MAINTENANCE_AUTO_EXPIRY_YEARS);
}

function defaultTitleForCategory(cat: MaintenanceCategory) {
  if (cat === 'technical_review') return 'Przegląd techniczny';
  if (cat === 'insurance') return 'Ubezpieczenie OC';
  return '';
}

function categoryLabel(id: MaintenanceCategory) {
  return CATEGORIES.find(c => c.id === id)?.label ?? id;
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('pl-PL');
  } catch {
    return '—';
  }
}

function toInputDate(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function parseInputDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null;
  const d = new Date(`${value.trim()}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function daysUntil(iso: string | null | undefined) {
  if (!iso) return null;
  const end = new Date(iso).getTime();
  if (Number.isNaN(end)) return null;
  return Math.ceil((end - Date.now()) / 86_400_000);
}

function expiryColor(days: number | null, theme: ReturnType<typeof useTheme>['theme']) {
  if (days == null) return theme.textDim;
  if (days < 0) return '#e33835';
  if (days <= 30) return '#ff922b';
  return '#4de926';
}

export default function CarMaintenanceScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const { id, brand } = useLocalSearchParams<{ id: string; brand?: string }>();
  const { isPremium, isLoading: premiumLoading } = useEffectivePremium();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [entries, setEntries] = useState<MaintenanceEntry[]>([]);
  const [summary, setSummary] = useState<MaintenanceSummary | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editEntry, setEditEntry] = useState<MaintenanceEntry | null>(null);

  const [category, setCategory] = useState<MaintenanceCategory>('service');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [performedAt, setPerformedAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [mileage, setMileage] = useState('');
  const [cost, setCost] = useState('');

  const load = useCallback(async (spinner = true) => {
    if (spinner) setLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/cars/${id}/maintenance`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 403) {
        router.replace('/premium' as any);
        return;
      }
      if (!res.ok) throw new Error();
      const data = await res.json();
      setEntries(data.entries ?? []);
      setSummary(data.summary ?? null);
    } catch {
      Toast.show({ type: 'error', text1: 'Błąd', text2: 'Nie udało się pobrać dziennika serwisowego.' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id, router]);

  useFocusEffect(
    useCallback(() => {
      if (!premiumLoading && !isPremium) {
        router.replace('/premium' as any);
        return;
      }
      if (isPremium) void load();
    }, [isPremium, premiumLoading, load, router]),
  );

  const openCreate = (initialCategory: MaintenanceCategory = 'service') => {
    setEditEntry(null);
    setCategory(initialCategory);
    setTitle(defaultTitleForCategory(initialCategory));
    setDescription('');
    setPerformedAt(new Date().toISOString().slice(0, 10));
    setExpiresAt('');
    setMileage('');
    setCost('');
    setModalOpen(true);
  };

  const openEdit = (entry: MaintenanceEntry) => {
    setEditEntry(entry);
    setCategory(entry.category);
    setTitle(entry.title);
    setDescription(entry.description ?? '');
    setPerformedAt(toInputDate(entry.performedAt));
    setExpiresAt(toInputDate(entry.expiresAt));
    setMileage(entry.mileage != null ? String(entry.mileage) : '');
    setCost(entry.cost != null ? String(entry.cost) : '');
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!title.trim()) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Podaj tytuł wpisu.' });
      return;
    }
    const performedIso = parseInputDate(performedAt);
    if (!performedIso) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Podaj datę w formacie RRRR-MM-DD.' });
      return;
    }
    const expiresIso = categoryUsesAutoExpiry(category)
      ? computeExpiryIso(category, performedIso)
      : (expiresAt.trim() ? parseInputDate(expiresAt) : null);
    if (!categoryUsesAutoExpiry(category) && expiresAt.trim() && !expiresIso) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Nieprawidłowa data ważności.' });
      return;
    }

    setSaving(true);
    try {
      const token = await getToken();
      const body = {
        category,
        title: title.trim(),
        description: description.trim() || null,
        performedAt: performedIso,
        expiresAt: expiresIso,
        mileage: mileage.trim() || null,
        cost: cost.trim() || null,
      };
      const url = editEntry
        ? `${API_URL}/api/cars/${id}/maintenance/${editEntry.id}`
        : `${API_URL}/api/cars/${id}/maintenance`;
      const res = await fetch(url, {
        method: editEntry ? 'PUT' : 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      setModalOpen(false);
      Toast.show({ type: 'success', text1: editEntry ? 'Zapisano zmiany' : 'Dodano wpis' });
      await load(false);
    } catch {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Nie udało się zapisać wpisu.' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (entry: MaintenanceEntry) => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/cars/${id}/maintenance/${entry.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error();
      Toast.show({ type: 'success', text1: 'Usunięto wpis' });
      await load(false);
    } catch {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Nie udało się usunąć wpisu.' });
    }
  };

  const inputStyle = {
    backgroundColor: theme.surface3,
    borderRadius: 10,
    padding: 14,
    color: theme.text,
    fontFamily: 'Orbitron' as const,
    fontSize: 13,
    borderWidth: 1,
    borderColor: theme.border2,
    marginBottom: 14,
  };
  const labelStyle = {
    fontFamily: 'Orbitron' as const,
    color: theme.textDim,
    fontSize: 11,
    marginBottom: 8,
    letterSpacing: 1,
  };

  if (loading || premiumLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  const reviewDays = daysUntil(summary?.technicalReviewExpiresAt);
  const insuranceDays = daysUntil(summary?.insuranceExpiresAt);

  return (
  <>
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bgAlt }}
      contentContainerStyle={{ paddingHorizontal: '5%', paddingBottom: 100 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(false); }} tintColor={theme.primary} />
      }
    >
      <View style={{ marginTop: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={{ fontFamily: 'Orbitron', color: theme.primary, fontSize: 12 }}>← Wróć</Text>
        </TouchableOpacity>
        <View style={{ alignItems: 'center', flex: 1 }}>
          <Text style={{ fontFamily: 'Orbitron', fontSize: 14, color: theme.text, letterSpacing: 2 }}>DZIENNIK SERWISOWY</Text>
          {!!brand && (
            <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim, marginTop: 4 }} numberOfLines={1}>
              {brand}
            </Text>
          )}
        </View>
        <TouchableOpacity
          onPress={() => openCreate()}
          style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center' }}
        >
          <MaterialIcons name="add" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
        <View style={{ flex: 1, backgroundColor: theme.surface3, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.border2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <MaterialIcons name="fact-check" size={16} color={expiryColor(reviewDays, theme)} />
            <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim }}>PRZEGLĄD</Text>
          </View>
          <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: theme.text, fontWeight: '700' }}>
            {formatDate(summary?.technicalReviewExpiresAt)}
          </Text>
          <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: expiryColor(reviewDays, theme), marginTop: 4 }}>
            {reviewDays == null ? 'Brak daty' : reviewDays < 0 ? 'Po terminie' : `Za ${reviewDays} dni`}
          </Text>
        </View>
        <View style={{ flex: 1, backgroundColor: theme.surface3, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.border2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <MaterialIcons name="verified-user" size={16} color={expiryColor(insuranceDays, theme)} />
            <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim }}>OC</Text>
          </View>
          <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: theme.text, fontWeight: '700' }}>
            {formatDate(summary?.insuranceExpiresAt)}
          </Text>
          <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: expiryColor(insuranceDays, theme), marginTop: 4 }}>
            {insuranceDays == null ? 'Brak daty' : insuranceDays < 0 ? 'Po terminie' : `Za ${insuranceDays} dni`}
          </Text>
        </View>
      </View>

      <Text style={labelStyle}>HISTORIA WPISÓW</Text>
      {entries.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: 40, gap: 10 }}>
          <MaterialIcons name="build-circle" size={42} color={theme.textDim} />
          <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.textDim, textAlign: 'center' }}>
            Brak wpisów. Dodaj serwis, przegląd lub polisę OC.
          </Text>
        </View>
      ) : (
        entries.map(entry => {
          const expDays = daysUntil(entry.expiresAt);
          return (
            <TouchableOpacity
              key={entry.id}
              onPress={() => openEdit(entry)}
              activeOpacity={0.85}
              style={{
                backgroundColor: theme.surface3,
                borderRadius: 14,
                padding: 14,
                marginBottom: 10,
                borderWidth: 1,
                borderColor: theme.border2,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.primary, marginBottom: 4 }}>
                    {categoryLabel(entry.category).toUpperCase()}
                  </Text>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: theme.text, fontWeight: '700' }}>{entry.title}</Text>
                  {!!entry.description && (
                    <Text style={{ color: theme.textDim, fontSize: 12, marginTop: 6, lineHeight: 18 }}>{entry.description}</Text>
                  )}
                </View>
                <TouchableOpacity onPress={() => void handleDelete(entry)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <MaterialIcons name="delete-outline" size={18} color={theme.primary} />
                </TouchableOpacity>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim }}>
                  Wykonano: {formatDate(entry.performedAt)}
                </Text>
                {entry.expiresAt && (
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: expiryColor(expDays, theme) }}>
                    Ważne do: {formatDate(entry.expiresAt)}
                  </Text>
                )}
                {entry.mileage != null && (
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim }}>{entry.mileage} km</Text>
                )}
                {entry.cost != null && (
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim }}>{entry.cost.toFixed(0)} zł</Text>
                )}
              </View>
            </TouchableOpacity>
          );
        })
      )}
    </ScrollView>

    <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
      <Pressable style={{ flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' }} onPress={() => setModalOpen(false)}>
        <Pressable onPress={e => e.stopPropagation()}>
          <ScrollView
            style={{ maxHeight: '88%', backgroundColor: theme.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24 }}
            contentContainerStyle={{ padding: 20, paddingBottom: 32 }}
          >
            <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: theme.text, letterSpacing: 2, marginBottom: 16, textAlign: 'center' }}>
              {editEntry ? 'EDYTUJ WPIS' : 'NOWY WPIS'}
            </Text>

            <Text style={labelStyle}>KATEGORIA</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              {CATEGORIES.map(c => (
                <TouchableOpacity
                  key={c.id}
                  onPress={() => {
                    setCategory(c.id);
                    if (categoryUsesAutoExpiry(c.id)) {
                      setExpiresAt('');
                      setTitle(prev => {
                        const defaults = new Set(
                          CATEGORIES.map(x => defaultTitleForCategory(x.id)).filter(Boolean),
                        );
                        return !prev.trim() || defaults.has(prev) ? defaultTitleForCategory(c.id) : prev;
                      });
                    }
                  }}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 6,
                    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
                    borderWidth: 1,
                    borderColor: category === c.id ? theme.primary : theme.border2,
                    backgroundColor: category === c.id ? theme.primaryBg : theme.surface3,
                  }}
                >
                  <MaterialIcons name={c.icon as any} size={14} color={category === c.id ? theme.primary : theme.textDim} />
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: category === c.id ? theme.primary : theme.textDim }}>
                    {c.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={labelStyle}>CO ZOSTAŁO ZROBIONE *</Text>
            <TextInput style={inputStyle} value={title} onChangeText={setTitle} placeholder="Np. Wymiana oleju i filtra" placeholderTextColor={theme.textDim} />

            <Text style={labelStyle}>OPIS (OPCJONALNIE)</Text>
            <TextInput
              style={[inputStyle, { height: 80, textAlignVertical: 'top' }]}
              value={description}
              onChangeText={setDescription}
              placeholder="Szczegóły, części, warsztat..."
              placeholderTextColor={theme.textDim}
              multiline
            />

            <Text style={labelStyle}>
              {category === 'technical_review'
                ? 'DATA PRZEGLĄDU * (RRRR-MM-DD)'
                : category === 'insurance'
                  ? 'DATA ZAWARCIA OC * (RRRR-MM-DD)'
                  : 'DATA WYKONANIA * (RRRR-MM-DD)'}
            </Text>
            <TextInput
              style={inputStyle}
              value={performedAt}
              onChangeText={setPerformedAt}
              placeholder="2026-05-23"
              placeholderTextColor={theme.textDim}
            />
            {categoryUsesAutoExpiry(category) && performedAt.trim() && parseInputDate(performedAt) && (
              <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.textDim, marginTop: -6, marginBottom: 14, lineHeight: 16 }}>
                Ważne do: {formatDate(computeExpiryIso(category, parseInputDate(performedAt)!))} (automatycznie +{MAINTENANCE_AUTO_EXPIRY_YEARS} rok)
              </Text>
            )}

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={labelStyle}>PRZEBIEG (KM)</Text>
                <TextInput style={inputStyle} value={mileage} onChangeText={setMileage} keyboardType="numeric" placeholder="125000" placeholderTextColor={theme.textDim} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={labelStyle}>KOSZT (ZŁ)</Text>
                <TextInput style={inputStyle} value={cost} onChangeText={setCost} keyboardType="decimal-pad" placeholder="450" placeholderTextColor={theme.textDim} />
              </View>
            </View>

            <TouchableOpacity
              onPress={() => void handleSave()}
              disabled={saving}
              style={{ backgroundColor: theme.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', opacity: saving ? 0.6 : 1 }}
            >
              {saving ? <ActivityIndicator color="#fff" /> : (
                <Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 12, fontWeight: '700' }}>ZAPISZ</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  </>
  );
}
