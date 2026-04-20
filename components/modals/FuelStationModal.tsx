import React, { useState, useEffect } from 'react';
import {
  View, Text, Modal, TouchableOpacity, Pressable,
  Platform, TextInput, ActivityIndicator,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../contexts/ThemeContext';
import type { FuelStation } from '../../hooks/useFuelStations';

interface Props {
  visible:          boolean;
  station:          FuelStation | null;
  onClose:          () => void;
  onNavigate?:      (lat: number, lng: number, name: string) => void;
  onPricesUpdated?: () => void;
  updatePrices:     (stationId: number, prices: { pb95?: number; pb98?: number; diesel?: number; lpg?: number }) => Promise<boolean>;
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'nieznane';
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  if (mins < 1)   return 'właśnie teraz';
  if (mins < 60)  return `${mins} min temu`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs} godz. temu`;
  return `${Math.floor(hrs / 24)} dni temu`;
}

const FUEL_ROWS: Array<{ key: keyof { pb95: number; pb98: number; diesel: number; lpg: number }; label: string; icon: string; color: string }> = [
  { key: 'pb95',   label: 'PB95',   icon: 'gas-station',  color: '#4de926' },
  { key: 'pb98',   label: 'PB98',   icon: 'gas-station',  color: '#00bfff' },
  { key: 'diesel', label: 'ON',     icon: 'fuel',         color: '#FFD700' },
  { key: 'lpg',    label: 'LPG',    icon: 'propane-tank', color: '#e33835' },
];

export function FuelStationModal({ visible, station, onClose, onNavigate, onPricesUpdated, updatePrices }: Props) {
  const { theme, isDark } = useTheme();

  const [editMode, setEditMode]     = useState(false);
  const [saving,   setSaving]       = useState(false);
  const [prices, setPrices]         = useState({ pb95: '', pb98: '', diesel: '', lpg: '' });

  useEffect(() => {
    if (station) {
      setEditMode(false);
      const p = station.prices?.[0];
      setPrices({
        pb95:   p?.pb95   != null ? String(p.pb95)   : '',
        pb98:   p?.pb98   != null ? String(p.pb98)   : '',
        diesel: p?.diesel != null ? String(p.diesel) : '',
        lpg:    p?.lpg    != null ? String(p.lpg)    : '',
      });
    }
  }, [station?.id]);

  if (!station) return null;

  const latestPrice = station.prices?.[0];

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: { pb95?: number; pb98?: number; diesel?: number; lpg?: number } = {};
      const fuelKeys = ['pb95', 'pb98', 'diesel', 'lpg'] as const;
      for (const k of fuelKeys) {
        const v = prices[k];
        if (v && !isNaN(Number(v))) payload[k] = Number(v);
      }

      if (Object.keys(payload).length === 0) {
        Toast.show({ type: 'error', text1: 'Błąd', text2: 'Podaj co najmniej jedną cenę.' });
        return;
      }

      const ok = await updatePrices(station.id, payload);
      if (ok) {
        Toast.show({ type: 'success', text1: '✅ Ceny zaktualizowane', text2: station.name });
        setEditMode(false);
        onPricesUpdated?.();
      } else {
        Toast.show({ type: 'error', text1: 'Błąd', text2: 'Nie udało się zaktualizować cen.' });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000000bb', justifyContent: 'flex-end' }}>
        <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} onPress={onClose} />
        <View style={{
          backgroundColor: theme.surface,
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          borderTopWidth: 1, borderColor: isDark ? '#1e1e1e' : '#e0e0e0',
          paddingBottom: Platform.OS === 'ios' ? 34 : 20,
          padding: 20,
        }}>
          {/* Handle */}
          <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: isDark ? '#333' : '#ddd', alignSelf: 'center', marginBottom: 18 }} />

          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 }}>
            <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: '#00bfff18', borderWidth: 1.5, borderColor: '#00bfff40', alignItems: 'center', justifyContent: 'center' }}>
              <MaterialCommunityIcons name="gas-station" size={26} color="#00bfff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 15, color: theme.text, fontWeight: '700', letterSpacing: 0.5 }} numberOfLines={1}>
                {station.name}
              </Text>
              {station.brand && (
                <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#00bfff', letterSpacing: 1, marginTop: 2 }}>
                  {station.brand.toUpperCase()}
                </Text>
              )}
            </View>
          </View>

          {/* Prices table */}
          <View style={{ backgroundColor: isDark ? '#111' : '#f8f8f8', borderRadius: 16, borderWidth: 1, borderColor: isDark ? '#1e1e1e' : '#e8e8e8', overflow: 'hidden', marginBottom: 16 }}>
            {FUEL_ROWS.map((row, i) => {
              const val = latestPrice?.[row.key];
              return (
                <View key={row.key} style={{
                  flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12,
                  borderBottomWidth: i < FUEL_ROWS.length - 1 ? 1 : 0, borderBottomColor: isDark ? '#1e1e1e' : '#efefef',
                }}>
                  <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: row.color + '18', borderWidth: 1, borderColor: row.color + '30', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                    <MaterialCommunityIcons name={row.icon as any} size={16} color={row.color} />
                  </View>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.text, fontWeight: '700', flex: 1 }}>{row.label}</Text>
                  {editMode ? (
                    <TextInput
                      style={{
                        color: theme.text, fontFamily: 'Orbitron', fontSize: 12,
                        backgroundColor: isDark ? '#1a1a1a' : '#fff',
                        borderRadius: 8, borderWidth: 1, borderColor: isDark ? '#333' : '#ddd',
                        paddingHorizontal: 10, paddingVertical: 6, minWidth: 80, textAlign: 'right',
                      }}
                      value={prices[row.key]}
                      onChangeText={v => setPrices(p => ({ ...p, [row.key]: v }))}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      placeholderTextColor={isDark ? '#444' : '#aaa'}
                    />
                  ) : (
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 14, color: val != null ? row.color : (isDark ? '#333' : '#ccc'), fontWeight: '700' }}>
                      {val != null ? `${val.toFixed(2)} zł` : '—'}
                    </Text>
                  )}
                </View>
              );
            })}
          </View>

          {/* Last update info */}
          {latestPrice?.updatedAt && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 }}>
              <MaterialCommunityIcons name="clock-outline" size={12} color={isDark ? '#555' : '#aaa'} />
              <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: isDark ? '#555' : '#aaa' }}>
                {latestPrice.updatedBy
                  ? `Zaktualizował @${latestPrice.updatedBy.username} · ${timeAgo(latestPrice.updatedAt)}`
                  : `Zaktualizowano ${timeAgo(latestPrice.updatedAt)}`
                }
              </Text>
            </View>
          )}

          {/* Edit mode form */}
          {editMode && (
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
              <TouchableOpacity
                style={{ flex: 1, paddingVertical: 13, borderRadius: 14, borderWidth: 1, borderColor: isDark ? '#333' : '#ddd', alignItems: 'center' }}
                onPress={() => setEditMode(false)}
                disabled={saving}
              >
                <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: isDark ? '#555' : '#aaa', fontWeight: '700' }}>ANULUJ</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 2, paddingVertical: 13, borderRadius: 14, backgroundColor: '#00bfff', alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
                onPress={handleSave}
                disabled={saving}
              >
                {saving
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <><MaterialCommunityIcons name="check" size={16} color="#fff" /><Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: '#fff', fontWeight: '700' }}>ZAPISZ</Text></>
                }
              </TouchableOpacity>
            </View>
          )}

          {/* Action buttons */}
          {!editMode && (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                style={{ flex: 1, paddingVertical: 13, borderRadius: 14, backgroundColor: '#00bfff18', borderWidth: 1, borderColor: '#00bfff40', alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
                onPress={() => setEditMode(true)}
              >
                <MaterialCommunityIcons name="pencil-outline" size={16} color="#00bfff" />
                <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: '#00bfff', fontWeight: '700' }}>AKTUALIZUJ CENY</Text>
              </TouchableOpacity>

              {onNavigate && (
                <TouchableOpacity
                  style={{ flex: 1, paddingVertical: 13, borderRadius: 14, backgroundColor: '#e3383518', borderWidth: 1, borderColor: '#e3383540', alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
                  onPress={() => { onNavigate(station.lat, station.lng, station.name); onClose(); }}
                >
                  <MaterialCommunityIcons name="navigation-outline" size={16} color="#e33835" />
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: '#e33835', fontWeight: '700' }}>NAWIGUJ</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}
