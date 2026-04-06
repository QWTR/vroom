import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal, Pressable,
} from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';

const RARITY_COLORS = {
  common:    { border: '#00000049', bg: '#ffffff05', dot: '#00000049', label: 'COMMON',    labelColor: '#000000' },
  rare:      { border: '#38a5e340', bg: '#38a5e310', dot: '#38a5e3',   label: 'RARE',      labelColor: '#38a5e3'   },
  epic:      { border: '#a338e340', bg: '#a338e310', dot: '#a338e3',   label: 'EPIC',      labelColor: '#a338e3'   },
  legendary: { border: '#f5c51860', bg: '#f5c51815', dot: '#f5c518',   label: 'LEGENDARY', labelColor: '#f5c518'   },
};

const CATEGORY_LABELS: Record<string, string> = {
  distance: '🛣️  Dystans',
  speed:    '⚡  Prędkość',
  streak:   '🔥  Streak',
  social:   '👥  Społeczność',
  special:  '⭐  Specjalne',
};

interface Props {
  icon:            string;
  label:           string;
  active:          boolean;
  rarity?:         'common' | 'rare' | 'epic' | 'legendary';
  progress?:       number;
  points?:         number;
  description?:    string;
  category?:       string;
  currentValue?:   number;
  conditionValue?: number;
  conditionField?: string;
  unlockedAt?:     string | null;
}

export default function AchievementBox({
  icon, label, active,
  rarity = 'common', progress = 0, points,
  description, category, currentValue, conditionValue,
  conditionField, unlockedAt,
}: Props) {
  const { theme } = useTheme();
  const [modalVisible, setModalVisible] = useState(false);
  const rc = RARITY_COLORS[rarity] ?? RARITY_COLORS.common;

  const unlockedDate = unlockedAt
    ? new Date(unlockedAt).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  return (
    <>
      {/* KAFELEK */}
      <TouchableOpacity
        activeOpacity={0.75}
        onPress={() => setModalVisible(true)}
        style={[
          {
            width: '31%',
            aspectRatio: 1,
            borderRadius: 14,
            borderWidth: 1.5,
            padding: 8,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 3,
            position: 'relative',
            // ── zawsze widoczny kontrast z tłem ──
            backgroundColor: theme.surface3,
            borderColor: theme.border2,
          },
          active && {
            borderColor: rc.border,
            backgroundColor: rc.bg,
          },
          !active && {
            opacity: 0.6,
          },
        ]}
      >
        <Text style={{ fontSize: 26, opacity: active ? 1 : 0.35 }}>{icon}</Text>

        <Text
          style={{ fontFamily: 'Orbitron', color: active ? theme.textMuted : theme.textFaint, fontSize: 7, textAlign: 'center', lineHeight: 10 }}
          numberOfLines={2}
        >
          {label}
        </Text>

        {active && !!points && points > 0 && (
          <Text style={{ fontFamily: 'Orbitron', color: '#f5c518', fontSize: 7 }}>+{points}</Text>
        )}

        {!active && progress > 0 && progress < 100 && (
          <View style={{ width: '85%', height: 2, backgroundColor: theme.border2, borderRadius: 2, marginTop: 3, overflow: 'hidden' }}>
            <View style={{ height: 2, backgroundColor: theme.primary, borderRadius: 2, width: `${progress}%` as any }} />
          </View>
        )}

        {active && (
          <View style={{ position: 'absolute', top: 6, right: 6, width: 6, height: 6, borderRadius: 3, backgroundColor: rc.dot }} />
        )}
      </TouchableOpacity>

      {/* MODAL */}
      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)}>
        <Pressable
          style={{ flex: 1, backgroundColor: theme.overlay, justifyContent: 'center', alignItems: 'center', padding: 24 }}
          onPress={() => setModalVisible(false)}
        >
          <Pressable
            style={{ width: '100%', backgroundColor: theme.surface3, borderRadius: 20, borderWidth: 1, borderColor: theme.border2, padding: 24, alignItems: 'center', gap: 10 }}
            onPress={() => {}}
          >
            {/* Ikona */}
            <View style={{ width: 80, height: 80, borderRadius: 20, borderWidth: 2, borderColor: rc.border, backgroundColor: rc.bg, alignItems: 'center', justifyContent: 'center', position: 'relative', marginBottom: 4 }}>
              <Text style={{ fontSize: 40 }}>{icon}</Text>
              {active && <View style={{ position: 'absolute', top: 6, right: 6, width: 10, height: 10, borderRadius: 5, backgroundColor: rc.dot }} />}
            </View>

            <Text style={{ fontFamily: 'Orbitron', fontSize: 9, letterSpacing: 2, borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4, color: rc.labelColor, borderColor: rc.border }}>
              {rc.label}
            </Text>

            <Text style={{ fontFamily: 'Orbitron', fontSize: 18, color: theme.text, fontWeight: '700', textAlign: 'center' }}>{label}</Text>

            {!!description && (
              <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.textDim, textAlign: 'center', lineHeight: 18 }}>{description}</Text>
            )}

            <View style={{ width: '100%', height: 1, backgroundColor: theme.border2, marginVertical: 4 }} />

            <View style={{ width: '100%', gap: 8 }}>
              {!!category && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textFaint, letterSpacing: 1 }}>KATEGORIA</Text>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.textMuted, flexShrink: 1, textAlign: 'right' }}>{CATEGORY_LABELS[category] ?? category}</Text>
                </View>
              )}
              {!!points && points > 0 && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textFaint, letterSpacing: 1 }}>NAGRODA</Text>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: '#f5c518', flexShrink: 1, textAlign: 'right' }}>⭐ {points} punktów</Text>
                </View>
              )}
              {!active && conditionValue != null && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textFaint, letterSpacing: 1 }}>POSTĘP</Text>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.textMuted, flexShrink: 1, textAlign: 'right' }}>
                    {currentValue ?? 0} / {conditionValue}{'  '}
                    <Text style={{ color: theme.primary }}>({progress}%)</Text>
                  </Text>
                </View>
              )}
              {!!conditionField && conditionValue != null && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textFaint, letterSpacing: 1 }}>WARUNEK</Text>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.textMuted, flexShrink: 1, textAlign: 'right' }}>{conditionField} ≥ {conditionValue}</Text>
                </View>
              )}
              {active && !!unlockedDate && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textFaint, letterSpacing: 1 }}>ODBLOKOWANO</Text>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: '#4de926', flexShrink: 1, textAlign: 'right' }}>✓ {unlockedDate}</Text>
                </View>
              )}
              {!active && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textFaint, letterSpacing: 1 }}>STATUS</Text>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.textDim, flexShrink: 1, textAlign: 'right' }}>🔒 Zablokowane</Text>
                </View>
              )}
            </View>

            {!active && progress > 0 && (
              <View style={{ width: '100%', gap: 6, marginTop: 4 }}>
                <View style={{ width: '100%', height: 4, backgroundColor: theme.border2, borderRadius: 4, overflow: 'hidden' }}>
                  <View style={{ height: 4, backgroundColor: theme.primary, borderRadius: 4, width: `${progress}%` as any }} />
                </View>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim, textAlign: 'right' }}>{progress}% ukończone</Text>
              </View>
            )}

            <TouchableOpacity
              style={{ marginTop: 8, backgroundColor: theme.surface4, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 32, borderWidth: 1, borderColor: theme.border2 }}
              onPress={() => setModalVisible(false)}
            >
              <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.text, letterSpacing: 2 }}>ZAMKNIJ</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}