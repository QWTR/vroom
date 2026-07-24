import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import React, { memo, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import type { SpeedLimitResolution } from '../../hooks/useSpeedLimit';
import { speedLimitDirectionLabel } from '../../lib/speedLimits/types';

const LIMITS = [20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140];

export const SpeedLimitReportModal = memo(function SpeedLimitReportModal({
  visible,
  resolution,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  resolution: SpeedLimitResolution;
  onClose: () => void;
  onSubmit: (limitKmh: number) => Promise<void>;
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const directionLabel = speedLimitDirectionLabel(resolution.direction);

  useEffect(() => {
    if (visible) setSelected(resolution.candidateLimitKmh ?? null);
  }, [visible, resolution.candidateLimitKmh]);

  const submit = async (limitKmh: number) => {
    setSubmitting(true);
    try {
      await onSubmit(limitKmh);
      onClose();
    } catch {
      // Komunikat błędu pokazuje właściciel ekranu; arkusz pozostaje otwarty.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.root} pointerEvents="box-none">
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: theme.surface, borderColor: theme.border, paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
          <View pointerEvents="none" style={[styles.handle, { backgroundColor: theme.border }]} />
          <View style={styles.header}>
            <View pointerEvents="none" style={styles.sign}><MaterialIcons name="add" size={25} color="#111" /></View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: theme.text }]}>DODAJ LIMIT</Text>
              <Text numberOfLines={1} style={[styles.road, { color: theme.textMuted }]}>
                {resolution.roadName || 'Rozpoznana droga'}{directionLabel ? ` · ${directionLabel}` : ''}
              </Text>
            </View>
            <TouchableOpacity style={styles.close} onPress={onClose}><MaterialIcons name="close" size={20} color={theme.textMuted} /></TouchableOpacity>
          </View>

          {resolution.candidateLimitKmh ? (
            <TouchableOpacity
              disabled={submitting}
              onPress={() => void submit(resolution.candidateLimitKmh!)}
              style={[styles.candidate, { backgroundColor: '#f59f0018', borderColor: '#f59f00' }]}
            >
              <MaterialCommunityIcons name="account-check" size={19} color="#f59f00" />
              <Text style={styles.candidateText}>POTWIERDŹ {resolution.candidateLimitKmh} KM/H</Text>
              <Text style={{ color: '#f59f00', fontWeight: '800' }}>+{resolution.candidateVotes ?? 1}</Text>
            </TouchableOpacity>
          ) : null}

          <Text style={[styles.label, { color: theme.textMuted }]}>WYBIERZ WARTOŚĆ</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.limits}>
            {LIMITS.map((limit) => {
              const active = selected === limit;
              return (
                <TouchableOpacity
                  key={limit}
                  disabled={submitting}
                  onPress={() => setSelected(limit)}
                  style={[styles.limitSign, active && styles.limitSignActive]}
                >
                  <Text style={styles.limitText}>{limit}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <TouchableOpacity
            disabled={selected == null || submitting}
            onPress={() => selected != null && void submit(selected)}
            style={[styles.submit, { backgroundColor: theme.primary }, (selected == null || submitting) && { opacity: 0.45 }]}
          >
            {submitting ? <ActivityIndicator color={theme.onPrimary} /> : <Text style={[styles.submitText, { color: theme.onPrimary }]}>ZGŁOŚ LIMIT</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, paddingHorizontal: 16, paddingTop: 8 },
  handle: { width: 42, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sign: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', borderWidth: 4, borderColor: '#e53935', alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'Orbitron', fontSize: 12, fontWeight: '900' },
  road: { fontSize: 11, marginTop: 3 },
  close: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  candidate: { height: 44, borderRadius: 13, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, marginTop: 14 },
  candidateText: { color: '#f59f00', flex: 1, fontFamily: 'Orbitron', fontSize: 9, fontWeight: '900' },
  label: { fontFamily: 'Orbitron', fontSize: 8, fontWeight: '800', letterSpacing: 1, marginTop: 16, marginBottom: 9 },
  limits: { gap: 9, paddingRight: 12 },
  limitSign: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#fff', borderWidth: 4, borderColor: '#e53935', alignItems: 'center', justifyContent: 'center', opacity: 0.7 },
  limitSignActive: { opacity: 1, transform: [{ scale: 1.06 }], borderColor: '#ff1f1f' },
  limitText: { color: '#111', fontFamily: 'Orbitron', fontWeight: '900', fontSize: 14 },
  submit: { height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  submitText: { fontFamily: 'Orbitron', fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
});
