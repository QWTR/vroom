import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  Pressable,
  Image,
} from 'react-native';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import type { OfficialMapMeet } from '../../hooks/useOfficialMapMeets';
import { normalizeMediaUri } from '../../lib/mediaUri';

interface Props {
  meet: OfficialMapMeet | null;
  visible: boolean;
  onClose: () => void;
  onOpenEvent: (meetId: number) => void;
  onNavigate?: (lat: number, lng: number, name: string) => void;
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('pl-PL', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatTicket(price: number | null | undefined, currency: string) {
  if (price == null) return null;
  if (price === 0) return 'Wstęp wolny';
  return `${price.toFixed(0)} ${currency || 'PLN'}`;
}

export function OfficialMeetMapModal({ meet, visible, onClose, onOpenEvent, onNavigate }: Props) {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  if (!meet) return null;

  const cover = normalizeMediaUri(meet.coverImage);
  const ticketLabel = formatTicket(meet.ticketPrice, meet.ticketCurrency);
  const spotsLeft = meet.maxParticipants - meet.participantsCount;
  const cardBg = isDark ? '#161616' : '#f8f8f8';
  const cardBorder = isDark ? '#2a2a2a' : '#e8e8e8';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000000bb', justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={{
          backgroundColor: cardBg,
          borderTopLeftRadius: 22,
          borderTopRightRadius: 22,
          borderWidth: 1,
          borderColor: cardBorder,
          paddingBottom: Math.max(insets.bottom, 16),
          maxHeight: '78%',
        }}>
          {cover ? (
            <Image
              source={{ uri: cover }}
              style={{ width: '100%', height: 150, borderTopLeftRadius: 22, borderTopRightRadius: 22 }}
              resizeMode="cover"
            />
          ) : (
            <View style={{
              width: '100%',
              height: 110,
              borderTopLeftRadius: 22,
              borderTopRightRadius: 22,
              backgroundColor: isDark ? '#1e1e1e' : '#ececec',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <MaterialCommunityIcons name="flag-checkered" size={42} color="#f5c518" />
            </View>
          )}

          <View style={{ padding: 18, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <View style={{ flex: 1, gap: 6 }}>
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                  <View style={{ backgroundColor: '#f5c518dd', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
                    <Text style={{ color: '#000', fontSize: 9, fontWeight: '900', letterSpacing: 0.5 }}>⭐ OFICJALNE</Text>
                  </View>
                  {meet.status === 'HOT' && (
                    <View style={{ backgroundColor: '#ff9800dd', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
                      <Text style={{ color: '#000', fontSize: 9, fontWeight: '900' }}>🔥 HOT</Text>
                    </View>
                  )}
                </View>
                <Text style={{ color: theme.text, fontSize: 20, fontWeight: '800' }}>{meet.title}</Text>
              </View>
              <TouchableOpacity onPress={onClose} hitSlop={12}>
                <MaterialIcons name="close" size={24} color={theme.textMuted} />
              </TouchableOpacity>
            </View>

            <View style={{ gap: 8 }}>
              <InfoRow icon="calendar-clock" label="Data" value={formatDate(meet.date)} theme={theme} />
              <InfoRow icon="map-marker" label="Miejsce" value={meet.locationName} theme={theme} />
              <InfoRow
                icon="account-group"
                label="Uczestnicy"
                value={`${meet.participantsCount}/${meet.maxParticipants}${spotsLeft > 0 ? ` · ${spotsLeft} wolnych` : ' · PEŁNE'}`}
                theme={theme}
              />
              {ticketLabel && (
                <InfoRow icon="ticket-confirmation" label="Bilety" value={ticketLabel} theme={theme} />
              )}
            </View>

            <TouchableOpacity
              onPress={() => onOpenEvent(meet.id)}
              activeOpacity={0.88}
              style={{
                backgroundColor: '#f5c518',
                borderRadius: 14,
                paddingVertical: 15,
                alignItems: 'center',
                marginTop: 4,
              }}
            >
              <Text style={{ color: '#000', fontSize: 15, fontWeight: '900', letterSpacing: 0.3 }}>
                Zobacz wydarzenie
              </Text>
            </TouchableOpacity>

            {onNavigate && (
              <TouchableOpacity
                onPress={() => onNavigate(meet.lat, meet.lng, meet.title)}
                activeOpacity={0.88}
                style={{
                  borderRadius: 14,
                  paddingVertical: 13,
                  alignItems: 'center',
                  borderWidth: 1,
                  borderColor: cardBorder,
                }}
              >
                <Text style={{ color: theme.text, fontSize: 14, fontWeight: '700' }}>
                  Nawiguj do miejsca
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function InfoRow({
  icon,
  label,
  value,
  theme,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  value: string;
  theme: { text: string; textMuted: string };
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <MaterialCommunityIcons name={icon} size={18} color="#f5c518" />
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.textMuted, fontSize: 11, fontWeight: '600' }}>{label}</Text>
        <Text style={{ color: theme.text, fontSize: 14, fontWeight: '700' }}>{value}</Text>
      </View>
    </View>
  );
}
