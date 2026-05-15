import React, { useEffect, useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import type { GiftData } from '../../hooks/useGifts';

type Props = {
  visible: boolean;
  gift:    GiftData;
  onClaim: (giftId: number) => Promise<boolean>;
  onClose: () => void;
};

export function GiftModal({ visible, gift, onClaim, onClose }: Props) {
  const { theme: t, isDark } = useTheme();
  const [claiming, setClaiming] = useState(false);
  const [claimed,  setClaimed]  = useState(false);

  useEffect(() => {
    if (!visible) return;
    setClaiming(false);
    setClaimed(false);
  }, [visible, gift.id]);

  const handleClaim = async () => {
    setClaiming(true);
    const ok = await onClaim(gift.id);
    if (ok) setClaimed(true);
    setClaiming(false);
  };

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{
        flex: 1, backgroundColor: '#000000bb',
        justifyContent: 'center', alignItems: 'center', padding: 20,
      }}>
        <View style={{
          width: '100%', maxWidth: 360,
          backgroundColor: t.surface, borderRadius: 28,
          padding: 28, alignItems: 'center',
          borderWidth: 1, borderColor: '#f5c51840',
        }}>
          {/* Ikona */}
          <View style={{
            width: 80, height: 80, borderRadius: 24,
            backgroundColor: '#f5c51820', borderWidth: 2, borderColor: '#f5c51840',
            alignItems: 'center', justifyContent: 'center', marginBottom: 16,
          }}>
            <Text style={{ fontSize: 40 }}>{claimed ? '✅' : gift.icon}</Text>
          </View>

          <Text style={{
            fontFamily: 'Orbitron', fontSize: 9, color: '#f5c518',
            letterSpacing: 3, marginBottom: 10,
          }}>
            {claimed ? 'ODEBRANO!' : 'PREZENT DLA CIEBIE'}
          </Text>

          <Text style={{
            fontFamily: 'Orbitron', fontSize: 18, color: t.text,
            fontWeight: '900', textAlign: 'center', marginBottom: 10, letterSpacing: 0.5,
          }}>
            {gift.title}
          </Text>

          {!!gift.description && (
            <Text style={{
              fontFamily: 'Orbitron', fontSize: 9, color: t.textDim,
              textAlign: 'center', lineHeight: 16, marginBottom: 20,
            }}>
              {gift.description}
            </Text>
          )}

          {/* Typ prezentu */}
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 6,
            backgroundColor: '#f5c51815', borderRadius: 10,
            paddingHorizontal: 14, paddingVertical: 8,
            borderWidth: 1, borderColor: '#f5c51830', marginBottom: 24,
          }}>
            <MaterialIcons
              name={gift.type === 'achievement' ? 'emoji-events' : 'stars'}
              size={14} color="#f5c518"
            />
            <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#f5c518', letterSpacing: 1 }}>
              {gift.type === 'achievement'
                ? `OSIĄGNIĘCIE: ${(gift.data as any)?.achievementKey ?? ''}`
                : `+${(gift.data as any)?.points ?? 0} PKT`
              }
            </Text>
          </View>

          {/* Przyciski */}
          {!claimed ? (
            <View style={{ width: '100%', flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                style={{
                  flex: 1,
                  backgroundColor: isDark ? '#ffffff10' : '#00000008',
                  borderRadius: 14,
                  paddingVertical: 14,
                  alignItems: 'center',
                  borderWidth: 1,
                  borderColor: isDark ? '#ffffff15' : '#00000015',
                }}
                onPress={onClose}
                activeOpacity={0.85}
              >
                <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: t.textDim }}>
                  POMIŃ
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[{
                  flex: 1.7,
                  backgroundColor: '#f5c518',
                  borderRadius: 14, paddingVertical: 14,
                  alignItems: 'center', flexDirection: 'row',
                  justifyContent: 'center', gap: 8,
                }, claiming && { opacity: 0.6 }]}
                onPress={handleClaim}
                disabled={claiming}
                activeOpacity={0.85}
              >
                {claiming
                  ? <ActivityIndicator size="small" color="#111" />
                  : <Text style={{ fontSize: 18 }}>🎁</Text>
                }
                <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: '#111', fontWeight: '900' }}>
                  ODBIERZ PREZENT
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={{
                width: '100%', backgroundColor: '#4de92620',
                borderRadius: 14, paddingVertical: 14,
                alignItems: 'center', borderWidth: 1, borderColor: '#4de92645',
              }}
              onPress={onClose}
              activeOpacity={0.85}
            >
              <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: '#4de926', fontWeight: '700' }}>
                SUPER, DZIĘKI! 🚀
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}