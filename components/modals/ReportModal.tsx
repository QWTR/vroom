import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import React, { memo, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { useModalBackHandler } from '../../hooks/useModalBackHandler';
import {
  REPORTABLE_WARNING_TYPES,
  WARNING_CATALOG,
  type CreateWarningInput,
  type WarningDirection,
  type WarningSubtype,
  type WarningType,
} from '../../lib/warnings/warningCatalog';

interface ReportModalProps {
  visible: boolean;
  onClose: () => void;
  onReport: (input: CreateWarningInput) => Promise<void>;
  isSubmitting?: boolean;
}

const DIRECTIONS: { value: WarningDirection; label: string }[] = [
  { value: 'same', label: 'Mój kierunek' },
  { value: 'opposite', label: 'Przeciwny' },
  { value: 'both', label: 'Oba kierunki' },
];

export const ReportModal = memo(function ReportModal({
  visible,
  onClose,
  onReport,
  isSubmitting = false,
}: ReportModalProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [detailed, setDetailed] = useState(false);
  const [type, setType] = useState<WarningType>('speed_control');
  const [subtype, setSubtype] = useState<WarningSubtype | null>(null);
  const [direction, setDirection] = useState<WarningDirection>('same');
  useModalBackHandler(visible, onClose);

  useEffect(() => {
    if (!visible) return;
    setDetailed(false);
    setType('speed_control');
    setSubtype(null);
    setDirection('same');
  }, [visible]);

  const submit = async (input: CreateWarningInput) => {
    await onReport({ direction: 'same', source: 'phone', ...input });
    onClose();
  };

  const selectedMeta = WARNING_CATALOG[type];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View pointerEvents="box-none" style={styles.modalRoot}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <View style={[
          styles.sheet,
          {
            backgroundColor: theme.surface,
            borderColor: theme.border,
            paddingBottom: Math.max(insets.bottom, 12) + 10,
          },
        ]}>
          <View pointerEvents="none" style={[styles.handle, { backgroundColor: theme.border }]} />
          <View style={styles.header}>
            <View pointerEvents="none" style={[styles.headerIcon, { backgroundColor: '#ff922b1f' }]}>
              <MaterialIcons name="warning" size={20} color="#ff922b" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.heading, { color: theme.text }]}>ZGŁOŚ NA DRODZE</Text>
              <Text style={[styles.subheading, { color: theme.textMuted }]}>Ostrzeżenie jest ważne przez 30 minut</Text>
            </View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Zamknij" onPress={onClose} style={styles.close}>
              <MaterialIcons name="close" size={20} color={theme.textMuted} />
            </TouchableOpacity>
          </View>

          {!detailed ? (
            <>
              <View style={styles.quickGrid}>
                {REPORTABLE_WARNING_TYPES.map((warningType) => {
                  const meta = WARNING_CATALOG[warningType];
                  return (
                    <TouchableOpacity
                      key={warningType}
                      disabled={isSubmitting}
                      activeOpacity={0.75}
                      onPress={() => void submit({ type: warningType })}
                      style={[styles.quickItem, { backgroundColor: `${meta.color}12`, borderColor: `${meta.color}55` }]}
                    >
                      <View pointerEvents="none" style={[styles.quickIcon, { backgroundColor: `${meta.color}20`, borderColor: meta.color }]}>
                        {isSubmitting ? (
                          <ActivityIndicator size="small" color={meta.color} />
                        ) : (
                          <MaterialCommunityIcons name={meta.icon as any} size={24} color={meta.color} />
                        )}
                      </View>
                      <Text numberOfLines={2} style={[styles.quickLabel, { color: theme.text }]}>{meta.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TouchableOpacity
                style={[styles.detailsButton, { borderColor: theme.border, backgroundColor: theme.surface2 }]}
                onPress={() => setDetailed(true)}
              >
                <MaterialCommunityIcons name="tune-variant" size={19} color={theme.primary} />
                <Text style={[styles.detailsButtonText, { color: theme.primary }]}>SZCZEGÓŁOWE</Text>
              </TouchableOpacity>
            </>
          ) : (
            <ScrollView style={styles.detailsScroll} contentContainerStyle={{ paddingBottom: 4 }} showsVerticalScrollIndicator={false}>
              <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>CO SIĘ DZIEJE?</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
                {REPORTABLE_WARNING_TYPES.map((warningType) => {
                  const meta = WARNING_CATALOG[warningType];
                  const active = type === warningType;
                  return (
                    <TouchableOpacity
                      key={warningType}
                      onPress={() => { setType(warningType); setSubtype(null); }}
                      style={[styles.categoryChip, { borderColor: active ? meta.color : theme.border, backgroundColor: active ? `${meta.color}18` : theme.surface2 }]}
                    >
                      <MaterialCommunityIcons name={meta.icon as any} size={17} color={active ? meta.color : theme.textMuted} />
                      <Text style={[styles.chipText, { color: active ? meta.color : theme.textMuted }]}>{meta.shortLabel}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>DOKŁADNIE</Text>
              <View style={styles.wrapRow}>
                {selectedMeta.subtypes.map((option) => {
                  const active = subtype === option.value;
                  return (
                    <TouchableOpacity
                      key={option.value}
                      onPress={() => setSubtype(option.value)}
                      style={[styles.optionChip, { borderColor: active ? selectedMeta.color : theme.border, backgroundColor: active ? `${selectedMeta.color}18` : theme.surface2 }]}
                    >
                      <Text style={[styles.optionText, { color: active ? selectedMeta.color : theme.text }]}>{option.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>KIERUNEK</Text>
              <View style={styles.wrapRow}>
                {DIRECTIONS.map((option) => {
                  const active = direction === option.value;
                  return (
                    <TouchableOpacity
                      key={option.value}
                      onPress={() => setDirection(option.value)}
                      style={[styles.optionChip, { borderColor: active ? theme.primary : theme.border, backgroundColor: active ? theme.primaryBg : theme.surface2 }]}
                    >
                      <Text style={[styles.optionText, { color: active ? theme.primary : theme.text }]}>{option.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={styles.footerRow}>
                <TouchableOpacity style={styles.backButton} onPress={() => setDetailed(false)}>
                  <MaterialIcons name="arrow-back" size={19} color={theme.textMuted} />
                  <Text style={{ color: theme.textMuted, fontWeight: '700' }}>Wróć</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  disabled={isSubmitting || (selectedMeta.subtypes.length > 0 && !subtype)}
                  onPress={() => void submit({ type, subtype, direction })}
                  style={[styles.submitButton, { backgroundColor: selectedMeta.color }, (isSubmitting || (selectedMeta.subtypes.length > 0 && !subtype)) && { opacity: 0.45 }]}
                >
                  {isSubmitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>WYŚLIJ</Text>}
                </TouchableOpacity>
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '62%', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, paddingHorizontal: 16, paddingTop: 8 },
  handle: { width: 42, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 10 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  headerIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  heading: { fontFamily: 'Orbitron', fontSize: 12, fontWeight: '900', letterSpacing: 0.8 },
  subheading: { fontSize: 11, marginTop: 2 },
  close: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  quickItem: { width: '23.5%', minHeight: 90, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center', padding: 7 },
  quickIcon: { width: 42, height: 42, borderRadius: 21, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { fontSize: 9, fontWeight: '800', textAlign: 'center', marginTop: 6 },
  detailsButton: { height: 44, borderRadius: 14, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12 },
  detailsButtonText: { fontFamily: 'Orbitron', fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
  detailsScroll: { flexGrow: 0 },
  sectionLabel: { fontFamily: 'Orbitron', fontSize: 8, fontWeight: '800', letterSpacing: 1, marginTop: 6, marginBottom: 8 },
  categoryRow: { gap: 7, paddingBottom: 6 },
  categoryChip: { height: 36, borderRadius: 12, borderWidth: 1, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5 },
  chipText: { fontSize: 8, fontWeight: '900' },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 8 },
  optionChip: { minHeight: 36, borderRadius: 12, borderWidth: 1, paddingHorizontal: 11, alignItems: 'center', justifyContent: 'center' },
  optionText: { fontSize: 11, fontWeight: '700' },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  backButton: { height: 44, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8 },
  submitButton: { flex: 1, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  submitText: { color: '#fff', fontFamily: 'Orbitron', fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
});
