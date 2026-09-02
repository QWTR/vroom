import React, { useEffect, useState, useCallback } from 'react';
import { View, Modal, TouchableOpacity, Linking, Pressable, ScrollView, ActivityIndicator, Platform, Dimensions } from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from '../ui/AppText';
import { Image } from 'expo-image';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { useKeyboardInset } from '../../hooks/useKeyboardInset';
import type { PartnerPoi } from '../../hooks/usePartnerPois';
import { normalizeMediaUri } from '../../lib/mediaUri';
import { LinearGradient } from 'expo-linear-gradient';
import { API_URL } from '../../constants/config';
import { useRouter } from 'expo-router';

const { width: SCREEN_W } = Dimensions.get('window');

const CATEGORY_ICONS: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  warsztat: 'car-wrench',
  myjnia: 'car-wash',
  tuning: 'engine',
  sklep: 'store',
  restauracja: 'silverware-fork-knife',
  hotel: 'bed',
  other: 'store',
};

const CATEGORY_LABELS: Record<string, string> = {
  warsztat: 'Warsztat',
  myjnia: 'Myjnia',
  tuning: 'Tuning',
  sklep: 'Sklep',
  restauracja: 'Restauracja',
  hotel: 'Hotel',
  other: 'Partner',
};

interface ReviewUser {
  id: number;
  username: string;
  avatarUrl: string | null;
}

interface Review {
  id: number;
  rating: number;
  comment: string | null;
  createdAt: string;
  user: ReviewUser;
  reply?: { body: string; updatedAt: string } | null;
}

interface GalleryImage {
  id: number;
  imageUrl: string;
  caption?: string | null;
}

interface BusinessDetail {
  poi: PartnerPoi & {
    address?: string | null;
    companyName?: string;
    phone?: string | null;
  };
  gallery?: GalleryImage[];
  stats: { averageRating: number | null; reviewCount: number };
  reviews: Review[];
  myReview: { id: number; rating: number; comment: string | null } | null;
}

interface Props {
  poi: PartnerPoi | null;
  visible: boolean;
  onClose: () => void;
  onNavigate?: (lat: number, lng: number, name: string) => void;
}

async function getToken(): Promise<string | null> {
  return (
    (await AsyncStorage.getItem('userToken'))
    ?? (await AsyncStorage.getItem('token'))
  );
}

function StarsRow({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <MaterialCommunityIcons
          key={i}
          name={i <= Math.round(rating) ? 'star' : 'star-outline'}
          size={size}
          color="#f39c12"
        />
      ))}
    </View>
  );
}

function InfoRow({
  icon,
  label,
  value,
  accent,
  valueColor,
  onPress,
  isDark,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  value: string;
  accent: string;
  valueColor: string;
  onPress?: () => void;
  isDark: boolean;
}) {
  const content = (
    <View style={{
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
    }}>
      <View style={{
        width: 36,
        height: 36,
        borderRadius: 10,
        backgroundColor: `${accent}18`,
        borderWidth: 1,
        borderColor: `${accent}35`,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <MaterialCommunityIcons name={icon} size={18} color={accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: isDark ? '#888' : '#999', letterSpacing: 1 }}>
          {label.toUpperCase()}
        </Text>
        <Text
          style={{
            fontSize: 14,
            fontWeight: onPress ? '600' : '500',
            color: onPress ? accent : valueColor,
            marginTop: 4,
            lineHeight: 20,
          }}
          numberOfLines={3}
        >
          {value}
        </Text>
      </View>
      {onPress && <MaterialIcons name="chevron-right" size={20} color={isDark ? '#555' : '#ccc'} />}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.75}>
        {content}
      </TouchableOpacity>
    );
  }
  return content;
}

export function PartnerPoiModal({ poi, visible, onClose, onNavigate }: Props) {
  const router = useRouter();
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [detail, setDetail] = useState<BusinessDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const keyboardInset = useKeyboardInset(visible && reviewOpen);

  const loadDetail = useCallback(async (poiId: number) => {
    setLoading(true);
    setReviewError('');
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/api/partner-pois/${poiId}/detail`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setDetail(data);
      if (data.myReview) {
        setReviewRating(data.myReview.rating);
        setReviewComment(data.myReview.comment || '');
      } else {
        setReviewRating(5);
        setReviewComment('');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible && poi?.id) {
      setReviewOpen(false);
      setGalleryIndex(0);
      void loadDetail(poi.id);
    } else {
      setDetail(null);
    }
  }, [visible, poi?.id, loadDetail]);

  if (!poi) return null;

  const accent = poi.markerAccentColor || detail?.poi?.markerAccentColor || '#FFD700';
  const logo = normalizeMediaUri(detail?.poi?.logoUrl || poi.logoUrl);
  const iconName = CATEGORY_ICONS[poi.category || 'other'] || 'store';
  const categoryLabel = CATEGORY_LABELS[poi.category || 'other'] || 'Partner';
  const display = detail?.poi || poi;
  const stats = detail?.stats;
  const gallery = detail?.gallery ?? [];
  const cardBg = isDark ? '#161616' : '#f8f8f8';
  const cardBorder = isDark ? '#2a2a2a' : '#e8e8e8';
  const divider = isDark ? '#2a2a2a' : '#efefef';
  const valueText = theme.text;

  const submitReview = async () => {
    setSubmitting(true);
    setReviewError('');
    try {
      const token = await getToken();
      if (!token) {
        setReviewError('Zaloguj się, aby dodać opinię');
        return;
      }
      const res = await fetch(`${API_URL}/api/partner-pois/${poi.id}/reviews`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ rating: reviewRating, comment: reviewComment.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setReviewError(data.error || 'Nie udało się dodać opinii');
        return;
      }
      setReviewOpen(false);
      await loadDetail(poi.id);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000000bb', justifyContent: 'flex-end' }}>
        <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} onPress={onClose} />

        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ justifyContent: 'flex-end', flexGrow: 1 }}
        >
          <View style={{
            backgroundColor: theme.surface,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            borderTopWidth: 1,
            borderColor: isDark ? '#1e1e1e' : '#e0e0e0',
            overflow: 'hidden',
            paddingBottom: keyboardInset > 0
              ? keyboardInset + 12
              : Math.max(insets.bottom, Platform.OS === 'ios' ? 34 : 20),
          }}>
            {/* Nagłówek — gradient zamiast rozciągniętego logo */}
            <LinearGradient
              colors={isDark
                ? [`${accent}35`, '#121212', theme.surface]
                : [`${accent}25`, '#f0f0f0', theme.surface]}
              style={{ height: 88, position: 'relative', justifyContent: 'flex-end', paddingBottom: 12, paddingHorizontal: 20 }}
            >
              <TouchableOpacity
                onPress={onClose}
                style={{
                  position: 'absolute',
                  top: 12,
                  right: 12,
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: 'rgba(0,0,0,0.45)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <MaterialIcons name="close" size={20} color="#fff" />
              </TouchableOpacity>
              <View style={{
                position: 'absolute',
                top: 12,
                left: 12,
                backgroundColor: '#e33835',
                paddingHorizontal: 10,
                paddingVertical: 5,
                borderRadius: 8,
              }}>
                <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '700', color: '#fff', letterSpacing: 1 }}>
                  PARTNER VROOM
                </Text>
              </View>
            </LinearGradient>

            {/* Header — logo + nazwa */}
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 14, paddingHorizontal: 20, marginTop: -28 }}>
              <View style={{
                width: 72,
                height: 72,
                borderRadius: 18,
                borderWidth: 2,
                borderColor: accent,
                backgroundColor: theme.surface,
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                shadowColor: '#000',
                shadowOpacity: 0.2,
                shadowRadius: 8,
                elevation: 6,
              }}>
                {logo ? (
                  <Image source={{ uri: logo }} style={{ width: 64, height: 64 }} contentFit="contain" />
                ) : (
                  <MaterialCommunityIcons name={iconName} size={34} color={accent} />
                )}
              </View>
              <View style={{ flex: 1, paddingBottom: 4 }}>
                <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 16, fontWeight: '700', color: theme.text, letterSpacing: 0.5 }} numberOfLines={2}>
                  {display.name}
                </Text>
                {!!(detail?.poi?.companyName && detail.poi.companyName !== display.name) && (
                  <Text style={{ fontSize: 12, color: theme.textDim, marginTop: 2 }}>{detail.poi.companyName}</Text>
                )}
                <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: accent, letterSpacing: 1, marginTop: 4 }}>
                  {categoryLabel.toUpperCase()}
                </Text>
              </View>
            </View>

            <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
              {/* Rating pill */}
              {loading ? (
                <ActivityIndicator color={accent} style={{ marginVertical: 12 }} />
              ) : stats && stats.reviewCount > 0 ? (
                <View style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  alignSelf: 'flex-start',
                  backgroundColor: cardBg,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: cardBorder,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  marginBottom: 16,
                }}>
                  <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 22, color: '#f39c12', fontWeight: '700' }}>
                    {stats.averageRating}
                  </Text>
                  <View>
                    <StarsRow rating={stats.averageRating || 0} size={14} />
                    <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, marginTop: 3 }}>
                      {stats.reviewCount} {stats.reviewCount === 1 ? 'OPINIA' : 'OPINII'}
                    </Text>
                  </View>
                </View>
              ) : null}

              {/* Description */}
              {!!display.description && (
                <Text style={{ color: theme.textDim, fontSize: 14, lineHeight: 22, marginBottom: 16 }}>
                  {display.description}
                </Text>
              )}

              <TouchableOpacity
                onPress={() => {
                  onClose();
                  router.push(`/partner/${poi.id}` as any);
                }}
                style={{
                  marginBottom: 16,
                  paddingVertical: 14,
                  borderRadius: 14,
                  backgroundColor: '#e33835',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'row',
                  gap: 8,
                }}
              >
                <MaterialCommunityIcons name="ticket-percent-outline" size={18} color="#fff" />
                <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: '#fff', fontWeight: '700' }}>
                  OFERTY · WYDARZENIA · KONTAKT
                </Text>
              </TouchableOpacity>

              {/* Galeria — osobna sekcja, bez rozciągania logo na hero */}
              {gallery.length > 0 && (
                <View style={{ marginBottom: 18 }}>
                  <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, letterSpacing: 1, marginBottom: 10 }}>
                    ZDJĘCIA · {gallery.length}
                  </Text>
                  <ScrollView
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={false}
                    onMomentumScrollEnd={(e) => {
                      const idx = Math.round(e.nativeEvent.contentOffset.x / (SCREEN_W - 40));
                      setGalleryIndex(idx);
                    }}
                    snapToInterval={SCREEN_W - 40}
                    decelerationRate="fast"
                    contentContainerStyle={{ gap: 12 }}
                  >
                    {gallery.map((img) => (
                      <View
                        key={img.id}
                        style={{
                          width: SCREEN_W - 40,
                          height: 200,
                          borderRadius: 16,
                          overflow: 'hidden',
                          backgroundColor: isDark ? '#0d0d0d' : '#e8e8e8',
                          borderWidth: 1,
                          borderColor: cardBorder,
                        }}
                      >
                        <Image
                          source={normalizeMediaUri(img.imageUrl) || undefined}
                          style={{ width: '100%', height: '100%' }}
                          contentFit="contain"
                          transition={200}
                        />
                      </View>
                    ))}
                  </ScrollView>
                  {gallery.length > 1 && (
                    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 10 }}>
                      {gallery.map((img, i) => (
                        <View
                          key={img.id}
                          style={{
                            width: i === galleryIndex ? 18 : 6,
                            height: 6,
                            borderRadius: 3,
                            backgroundColor: i === galleryIndex ? accent : (isDark ? '#444' : '#ccc'),
                          }}
                        />
                      ))}
                    </View>
                  )}
                </View>
              )}

              {/* Info card */}
              <View style={{
                backgroundColor: cardBg,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: cardBorder,
                overflow: 'hidden',
                marginBottom: 16,
              }}>
                {!!(detail?.poi?.address || poi.address) && (
                  <>
                    <InfoRow
                      icon="map-marker-outline"
                      label="Adres"
                      value={detail?.poi?.address || poi.address || ''}
                      accent={accent}
                      valueColor={valueText}
                      isDark={isDark}
                    />
                    <View style={{ height: 1, backgroundColor: divider }} />
                  </>
                )}
                {!!detail?.poi?.phone && (
                  <>
                    <InfoRow
                      icon="phone-outline"
                      label="Telefon"
                      value={detail.poi.phone}
                      accent={accent}
                      valueColor={valueText}
                      isDark={isDark}
                      onPress={() => Linking.openURL(`tel:${detail.poi!.phone}`)}
                    />
                    <View style={{ height: 1, backgroundColor: divider }} />
                  </>
                )}
                {!!display.websiteUrl && (
                  <InfoRow
                    icon="web"
                    label="Strona WWW"
                    value={display.websiteUrl.replace(/^https?:\/\//, '')}
                    accent={accent}
                    valueColor={valueText}
                    isDark={isDark}
                    onPress={() => Linking.openURL(display.websiteUrl!)}
                  />
                )}
              </View>

              {/* Action buttons — jak stacja paliw */}
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
                {onNavigate && (
                  <TouchableOpacity
                    style={{
                      flex: 1,
                      paddingVertical: 13,
                      borderRadius: 14,
                      backgroundColor: '#e3383518',
                      borderWidth: 1,
                      borderColor: '#e3383540',
                      alignItems: 'center',
                      flexDirection: 'row',
                      justifyContent: 'center',
                      gap: 8,
                    }}
                    onPress={() => { onNavigate(poi.lat, poi.lng, poi.name); onClose(); }}
                  >
                    <MaterialCommunityIcons name="navigation-outline" size={16} color="#e33835" />
                    <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: '#e33835', fontWeight: '700' }}>NAWIGUJ</Text>
                  </TouchableOpacity>
                )}
                {!!display.websiteUrl && (
                  <TouchableOpacity
                    style={{
                      flex: 1,
                      paddingVertical: 13,
                      borderRadius: 14,
                      backgroundColor: `${accent}18`,
                      borderWidth: 1,
                      borderColor: `${accent}40`,
                      alignItems: 'center',
                      flexDirection: 'row',
                      justifyContent: 'center',
                      gap: 8,
                    }}
                    onPress={() => Linking.openURL(display.websiteUrl!)}
                  >
                    <MaterialCommunityIcons name="open-in-new" size={16} color={accent} />
                    <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: accent, fontWeight: '700' }}>STRONA</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Reviews */}
              {detail && detail.reviews.length > 0 && (
                <View style={{
                  backgroundColor: cardBg,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: cardBorder,
                  overflow: 'hidden',
                  marginBottom: 16,
                }}>
                  <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: divider }}>
                    <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.text, fontWeight: '700', letterSpacing: 0.5 }}>
                      OPINIE UŻYTKOWNIKÓW
                    </Text>
                  </View>
                  {detail.reviews.slice(0, 6).map((r, i) => (
                    <View
                      key={r.id}
                      style={{
                        paddingHorizontal: 16,
                        paddingVertical: 12,
                        borderBottomWidth: i < Math.min(detail.reviews.length, 6) - 1 ? 1 : 0,
                        borderBottomColor: divider,
                      }}
                    >
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.text, fontWeight: '600' }}>
                          @{r.user.username}
                        </Text>
                        <StarsRow rating={r.rating} size={11} />
                      </View>
                      {!!r.comment && (
                        <Text style={{ color: theme.textDim, fontSize: 13, marginTop: 6, lineHeight: 20 }}>{r.comment}</Text>
                      )}
                      {!!r.reply && (
                        <View style={{ marginTop: 9, padding: 10, borderLeftWidth: 2, borderLeftColor: accent, backgroundColor: `${accent}10` }}>
                          <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: accent }}>ODPOWIEDŹ FIRMY</Text>
                          <Text style={{ color: theme.textDim, fontSize: 12, marginTop: 5, lineHeight: 18 }}>{r.reply.body}</Text>
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              )}

              {/* Review form toggle / panel */}
              {!reviewOpen ? (
                <TouchableOpacity
                  onPress={() => setReviewOpen(true)}
                  style={{
                    paddingVertical: 13,
                    borderRadius: 14,
                    backgroundColor: cardBg,
                    borderWidth: 1,
                    borderColor: cardBorder,
                    alignItems: 'center',
                    flexDirection: 'row',
                    justifyContent: 'center',
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <MaterialCommunityIcons name="star-outline" size={16} color="#f39c12" />
                  <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.text, fontWeight: '700' }}>
                    {detail?.myReview ? 'EDYTUJ SWOJĄ OPINIĘ' : 'WYSTAW OPINIĘ'}
                  </Text>
                </TouchableOpacity>
              ) : (
                <View style={{
                  backgroundColor: cardBg,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: cardBorder,
                  padding: 16,
                  marginBottom: 8,
                }}>
                  <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.text, marginBottom: 12, fontWeight: '700' }}>
                    TWOJA OCENA
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                    {[1, 2, 3, 4, 5].map((i) => (
                      <TouchableOpacity key={i} onPress={() => setReviewRating(i)} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
                        <MaterialCommunityIcons
                          name={i <= reviewRating ? 'star' : 'star-outline'}
                          size={30}
                          color="#f39c12"
                        />
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TextInput
                    value={reviewComment}
                    onChangeText={setReviewComment}
                    placeholder="Napisz kilka słów (opcjonalnie)…"
                    placeholderTextColor={isDark ? '#444' : '#aaa'}
                    multiline
                    maxLength={1000}
                    style={{
                      backgroundColor: isDark ? '#1a1a1a' : '#fff',
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: isDark ? '#333' : '#ddd',
                      color: theme.text,
                      padding: 12,
                      minHeight: 80,
                      fontSize: 14,
                      textAlignVertical: 'top',
                    }}
                  />
                  {!!reviewError && (
                    <Text style={{ color: '#e74c3c', fontSize: 12, marginTop: 8 }}>{reviewError}</Text>
                  )}
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                    <TouchableOpacity
                      onPress={() => setReviewOpen(false)}
                      style={{
                        flex: 1,
                        paddingVertical: 13,
                        borderRadius: 14,
                        borderWidth: 1,
                        borderColor: isDark ? '#333' : '#ddd',
                        alignItems: 'center',
                      }}
                    >
                      <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, fontWeight: '700' }}>ANULUJ</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={submitReview}
                      disabled={submitting}
                      style={{
                        flex: 2,
                        paddingVertical: 13,
                        borderRadius: 14,
                        backgroundColor: '#f39c12',
                        alignItems: 'center',
                        flexDirection: 'row',
                        justifyContent: 'center',
                        gap: 8,
                        opacity: submitting ? 0.6 : 1,
                      }}
                    >
                      {submitting ? (
                        <ActivityIndicator size="small" color="#000" />
                      ) : (
                        <>
                          <MaterialCommunityIcons name="check" size={16} color="#000" />
                          <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: '#000', fontWeight: '700' }}>
                            {detail?.myReview ? 'ZAKTUALIZUJ' : 'OPUBLIKUJ'}
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: isDark ? '#333' : '#ddd', alignSelf: 'center', marginTop: 8 }} />
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
