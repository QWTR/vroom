import React, { useState } from 'react';
import { View, TouchableOpacity, Modal, Pressable } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { useTheme } from '../../contexts/ThemeContext';
import { CATEGORY_LABELS } from '../../constants/achievementLabels';
import { GLASS_SHADOW, resolveProfileCardTheme, type ProfileCardTheme } from './profileCardTheme';

const RARITY_COLORS = {
  common:    { border: '#00000049', bg: '#ffffff05', dot: '#00000049', label: 'COMMON',    labelColor: '#000000' },
  rare:      { border: '#38a5e340', bg: '#38a5e310', dot: '#38a5e3',   label: 'RARE',      labelColor: '#38a5e3'   },
  epic:      { border: '#a338e340', bg: '#a338e310', dot: '#a338e3',   label: 'EPIC',      labelColor: '#a338e3'   },
  legendary: { border: '#f5c51860', bg: '#f5c51815', dot: '#f5c518',   label: 'LEGENDARY', labelColor: '#f5c518'   },
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
  theme?:          ProfileCardTheme;
}

export default function AchievementBox({
  icon, label, active,
  rarity = 'common', progress = 0, points,
  description, category, currentValue, conditionValue,
  conditionField, unlockedAt,
  theme: profileTheme,
}: Props) {
  const { theme: globalTheme } = useTheme();
  const theme = resolveProfileCardTheme(globalTheme, profileTheme);
  const [modalVisible, setModalVisible] = useState(false);
  const rc = RARITY_COLORS[rarity] ?? RARITY_COLORS.common;

  const unlockedDate = unlockedAt
    ? new Date(unlockedAt).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  return (
    <>
      <TouchableOpacity
        activeOpacity={0.75}
        onPress={() => setModalVisible(true)}
        style={[
          {
            width: '31%',
            aspectRatio: 1,
            borderRadius: 20,
            borderWidth: 1,
            padding: 10,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            position: 'relative',
            backgroundColor: theme.surface,
            borderColor: theme.border,
            ...GLASS_SHADOW,
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
          style={{
            fontFamily: 'Manrope_600SemiBold',
            color: active ? theme.text : theme.textDim,
            fontSize: 12,
            letterSpacing: 0.5,
            textAlign: 'center',
            lineHeight: 16,
          }}
          numberOfLines={2}
        >
          {label}
        </Text>

        {active && !!points && points > 0 && (
          <Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#f5c518', fontSize: 12 }}>+{points}</Text>
        )}

        {!active && progress > 0 && progress < 100 && (
          <View style={{ width: '85%', height: 2, backgroundColor: theme.border2, borderRadius: 2, marginTop: 3, overflow: 'hidden' }}>
            <View style={{ height: 2, backgroundColor: theme.primary, borderRadius: 2, width: `${progress}%` as any }} />
          </View>
        )}

        {active && (
          <View style={{ position: 'absolute', top: 8, right: 8, width: 6, height: 6, borderRadius: 3, backgroundColor: rc.dot }} />
        )}
      </TouchableOpacity>

      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)}>
        <Pressable
          style={{ flex: 1, backgroundColor: theme.overlay, justifyContent: 'center', alignItems: 'center', padding: 24 }}
          onPress={() => setModalVisible(false)}
        >
          <Pressable
            style={{
              width: '100%',
              backgroundColor: theme.surface,
              borderRadius: 20,
              borderWidth: 1,
              borderColor: theme.border,
              padding: 24,
              alignItems: 'center',
              gap: 10,
              ...GLASS_SHADOW,
            }}
            onPress={() => {}}
          >
            <View style={{
              width: 80,
              height: 80,
              borderRadius: 20,
              borderWidth: 2,
              borderColor: rc.border,
              backgroundColor: rc.bg,
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              marginBottom: 4,
            }}>
              <Text style={{ fontSize: 40 }}>{icon}</Text>
              {active && <View style={{ position: 'absolute', top: 6, right: 6, width: 10, height: 10, borderRadius: 5, backgroundColor: rc.dot }} />}
            </View>

            <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 1, borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4, color: rc.labelColor, borderColor: rc.border }}>
              {rc.label}
            </Text>

            <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 18, color: theme.text, fontWeight: '700', textAlign: 'center' }}>{label}</Text>

            {!!description && (
              <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, textAlign: 'center', lineHeight: 18 }}>{description}</Text>
            )}

            <View style={{ width: '100%', height: 1, backgroundColor: theme.border2, marginVertical: 4 }} />

            <View style={{ width: '100%', gap: 8 }}>
              {!!category && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, letterSpacing: 1 }}>KATEGORIA</Text>
                  <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.text, flexShrink: 1, textAlign: 'right' }}>{CATEGORY_LABELS[category] ?? category}</Text>
                </View>
              )}
              {!!points && points > 0 && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, letterSpacing: 1 }}>NAGRODA</Text>
                  <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: '#f5c518', flexShrink: 1, textAlign: 'right' }}>⭐ {points} punktów</Text>
                </View>
              )}
              {!active && conditionValue != null && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, letterSpacing: 1 }}>POSTĘP</Text>
                  <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.text, flexShrink: 1, textAlign: 'right' }}>
                    {currentValue ?? 0} / {conditionValue}{'  '}
                    <Text style={{ color: theme.primary }}>({progress}%)</Text>
                  </Text>
                </View>
              )}
              {!!conditionField && conditionValue != null && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, letterSpacing: 1 }}>WARUNEK</Text>
                  <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.text, flexShrink: 1, textAlign: 'right' }}>{conditionField} ≥ {conditionValue}</Text>
                </View>
              )}
              {active && !!unlockedDate && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, letterSpacing: 1 }}>ODBLOKOWANO</Text>
                  <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: '#4de926', flexShrink: 1, textAlign: 'right' }}>✓ {unlockedDate}</Text>
                </View>
              )}
              {!active && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, letterSpacing: 1 }}>STATUS</Text>
                  <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, flexShrink: 1, textAlign: 'right' }}>🔒 Zablokowane</Text>
                </View>
              )}
            </View>

            {!active && progress > 0 && (
              <View style={{ width: '100%', gap: 6, marginTop: 4 }}>
                <View style={{ width: '100%', height: 4, backgroundColor: theme.border2, borderRadius: 4, overflow: 'hidden' }}>
                  <View style={{ height: 4, backgroundColor: theme.primary, borderRadius: 4, width: `${progress}%` as any }} />
                </View>
                <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, textAlign: 'right' }}>{progress}% ukończone</Text>
              </View>
            )}

            <TouchableOpacity
              style={{
                marginTop: 8,
                backgroundColor: theme.surface3,
                borderRadius: 12,
                paddingVertical: 12,
                paddingHorizontal: 32,
                borderWidth: 1,
                borderColor: theme.border,
              }}
              onPress={() => setModalVisible(false)}
            >
              <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.text, letterSpacing: 1 }}>ZAMKNIJ</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
