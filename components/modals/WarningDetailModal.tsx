import React, { memo } from 'react';
import { Modal, View, Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { makeMapStyles } from '../../styles/mapstyle';
import { useTheme } from '../../contexts/ThemeContext';
import { LiveWarning, getWarningColor, getWarningIcon, getWarningLabel } from '../../hooks/useLiveMap';

interface Props {
  visible:        boolean;
  warning:        LiveWarning | null;
  onClose:        () => void;
  onConfirm:      (id: number) => void;
  currentUserId?: number;
}

export const WarningDetailModal = memo(({ visible, warning, onClose, onConfirm, currentUserId }: Props) => {
  const { theme, isDark } = useTheme();
  const styles    = makeMapStyles(theme);

  if (!warning) return null;

  const color    = getWarningColor(warning.type);
  const icon     = getWarningIcon(warning.type);
  const label    = getWarningLabel(warning.type);
  const timeLeft = Math.max(0, Math.round((new Date(warning.expiresAt).getTime() - Date.now()) / 60000));
  const isOwn    = warning.user.id === currentUserId;

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <SafeAreaView style={styles.drawerModalContainer}>
        <View style={styles.drawerModal}>
          <View style={styles.drawerHandle} />

          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 14 }}>
            <View style={{
              width: 56, height: 56, borderRadius: 16,
              backgroundColor: `${color}18`,
              borderWidth: 2, borderColor: `${color}45`,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <MaterialCommunityIcons name={icon as any} size={28} color={color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.drawerTitle, { marginBottom: 4 }]}>{label.toUpperCase()}</Text>
              <Text style={styles.drawerSectionLabel}>
                Zgłoszone przez {warning.user.username}
              </Text>
            </View>
            <TouchableOpacity style={styles.drawerCloseBtn} onPress={onClose}>
              <MaterialIcons name="close" size={18} color={theme.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Wiadomość */}
          {warning.message ? (
            <View style={{
              backgroundColor: theme.border,
              borderRadius: 12, padding: 14,
              borderWidth: 1, borderColor: theme.border2,
              marginBottom: 16,
            }}>
              <Text style={{ color: theme.textMuted, fontFamily: 'Orbitron', fontSize: 10, letterSpacing: 0.5 }}>
                {warning.message}
              </Text>
            </View>
          ) : null}

          {/* Statystyki */}
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 20 }}>
            <View style={{
              flex: 1, backgroundColor: theme.border, borderRadius: 12,
              borderWidth: 1, borderColor: theme.border2, padding: 12, alignItems: 'center',
            }}>
              <MaterialIcons name="schedule" size={18} color={theme.textDim} />
              <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 16, fontWeight: '700', marginTop: 4 }}>
                {15 - timeLeft}
              </Text>
              <Text style={styles.statLabel}>MIN TEMU</Text>
            </View>

            <View style={{
              flex: 1, backgroundColor: `${color}12`, borderRadius: 12,
              borderWidth: 1, borderColor: `${color}30`, padding: 12, alignItems: 'center',
            }}>
              <MaterialIcons name="thumb-up" size={18} color={color} />
              <Text style={{ color, fontFamily: 'Orbitron', fontSize: 16, fontWeight: '700', marginTop: 4 }}>
                {warning.confirmCount}
              </Text>
              <Text style={styles.statLabel}>POTWIERDZENIA</Text>
            </View>
          </View>

          <View style={styles.drawerDivider} />

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <MaterialIcons name="info-outline" size={14} color={theme.textDim} />
            <Text style={[styles.drawerSectionLabel, { marginBottom: 0 }]}>
              Potwierdzenie przedłuża ostrzeżenie o 15 minut
            </Text>
          </View>

          {!isOwn && (
            <TouchableOpacity
              style={{
                flexDirection: 'row', alignItems: 'center',
                justifyContent: 'center', gap: 10, paddingVertical: 15,
                backgroundColor: `${color}20`,
                borderRadius: 14, borderWidth: 2, borderColor: color,
              }}
              activeOpacity={0.8}
              onPress={() => { onConfirm(warning.id); onClose(); }}
            >
              <MaterialIcons name="thumb-up" size={20} color={color} />
              <Text style={{ color, fontFamily: 'Orbitron', fontWeight: '700', fontSize: 11, letterSpacing: 2 }}>
                POTWIERDŹ OSTRZEŻENIE
              </Text>
            </TouchableOpacity>
          )}

          {isOwn && (
            <View style={{
              padding: 14, backgroundColor: theme.border,
              borderRadius: 12, alignItems: 'center',
            }}>
              <Text style={[styles.drawerSectionLabel, { marginBottom: 0, textAlign: 'center' }]}>
                TO TWOJE OSTRZEŻENIE — INNI MOGĄ JE POTWIERDZIĆ
              </Text>
            </View>
          )}

        </View>
      </SafeAreaView>
    </Modal>
  );
});