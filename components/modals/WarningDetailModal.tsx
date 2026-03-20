import React, { memo } from 'react';
import {
  Modal, View, Text, TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { styles }          from '../../styles/mapstyle';
import { LiveWarning, getWarningColor, getWarningIcon, getWarningLabel } from '../../hooks/useLiveMap';

interface Props {
  visible:         boolean;
  warning:         LiveWarning | null;
  onClose:         () => void;
  onConfirm:       (id: number) => void;
  currentUserId?:  number;
}

export const WarningDetailModal = memo(({ visible, warning, onClose, onConfirm, currentUserId }: Props) => {
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
              <MaterialIcons name="close" size={18} color="#ffffff70" />
            </TouchableOpacity>
          </View>

          {/* Wiadomość */}
          {warning.message ? (
            <View style={{
              backgroundColor: '#ffffff08',
              borderRadius: 12, padding: 14,
              borderWidth: 1, borderColor: '#ffffff10',
              marginBottom: 16,
            }}>
              <Text style={{ color: '#ffffff70', fontFamily: 'Orbitron', fontSize: 10, letterSpacing: 0.5 }}>
                {warning.message}
              </Text>
            </View>
          ) : null}

          {/* Statystyki */}
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 20 }}>
            {/* Czas */}
            <View style={{
              flex: 1, backgroundColor: '#ffffff08', borderRadius: 12,
              borderWidth: 1, borderColor: '#ffffff10', padding: 12, alignItems: 'center',
            }}>
              <MaterialIcons name="schedule" size={18} color="#ffffff35" />
              <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 16, fontWeight: '700', marginTop: 4 }}>
                {15 - timeLeft}
              </Text>
              <Text style={styles.statLabel}>MIN TEMU</Text>
            </View>

            {/* Potwierdzenia */}
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

          {/* Info o systemie */}
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 8,
            marginBottom: 16,
          }}>
            <MaterialIcons name="info-outline" size={14} color="#ffffff35" />
            <Text style={[styles.drawerSectionLabel, { marginBottom: 0 }]}>
              Potwierdzenie przedłuża ostrzeżenie o 15 minut
            </Text>
          </View>

          {/* Przycisk potwierdzenia */}
          {!isOwn && (
            <TouchableOpacity
              style={{
                flexDirection: 'row', alignItems: 'center',
                justifyContent: 'center', gap: 10,
                paddingVertical: 15,
                backgroundColor: `${color}20`,
                borderRadius: 14, borderWidth: 2, borderColor: color,
              }}
              activeOpacity={0.8}
              onPress={() => { onConfirm(warning.id); onClose(); }}
            >
              <MaterialIcons name="thumb-up" size={20} color={color} />
              <Text style={{
                color,
                fontFamily: 'Orbitron',
                fontWeight: '700',
                fontSize: 11,
                letterSpacing: 2,
              }}>
                POTWIERDŹ OSTRZEŻENIE
              </Text>
            </TouchableOpacity>
          )}

          {isOwn && (
            <View style={{
              padding: 14, backgroundColor: '#ffffff08',
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