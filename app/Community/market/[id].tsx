import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  StatusBar, FlatList, Alert, Platform, Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../../contexts/ThemeContext';
import { API_URL } from '../../../constants/config';
import { getMarketViewerKey } from '../../../utils/marketViewerKey';
import { CommunityScreenHeader } from '../../../components/community';

interface Seller {
  id: number;
  username: string;
  avatarUrl: string | null;
}

interface MarketConvPreview {
  id: number;
  updatedAt: string;
  buyer: { id: number; username: string; avatarUrl: string | null };
  messages: { content: string | null; createdAt: string; sender: { id: number; username: string } }[];
}

interface Listing {
  id: number;
  title: string;
  category: string;
  brand: string | null;
  model: string | null;
  year: number | null;
  mileage: number | null;
  power: number | null;
  drive: string | null;
  transmission: string | null;
  color: string | null;
  fuel?: string | null;
  fuelType?: string | null;
  price: number;
  description: string | null;
  photos: string[];
  createdAt: string;
  seller: Seller;
  viewsCount?: number;
  views?: number;
  status?: string;
  isPromoted?: boolean;
  promotedUntil?: string | null;
  location?: string | null;
}

function formatPrice(price: number) {
  return price.toLocaleString('pl-PL') + ' PLN';
}

const { width: SCREEN_W } = Dimensions.get('window');
const GALLERY_H = 280;

export default function ListingDetailScreen() {
  const { id }  = useLocalSearchParams<{ id: string }>();
  const router  = useRouter();
  const { theme, isDark } = useTheme();

  const [listing,       setListing]       = useState<Listing | null>(null);
  const [loading,       setLoading]       = useState(true);
  const [myId,          setMyId]          = useState<number | null>(null);
  const [contacting,    setContacting]    = useState(false);
  const [deleting,      setDeleting]      = useState(false);
  const [promoting,     setPromoting]     = useState(false);
  const [activePhotoIdx, setActivePhotoIdx] = useState(0);
  const [inquiries,      setInquiries]      = useState<MarketConvPreview[]>([]);
  const [loadingInquiries, setLoadingInquiries] = useState(false);

  const getToken = async () =>
    (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token')) ?? '';

  const openUserProfile = useCallback((userId: number) => {
    router.push({ pathname: '/profile/[userId]', params: { userId: String(userId) } } as any);
  }, [router]);

  useEffect(() => {
    AsyncStorage.getItem('user').then(raw => {
      if (raw) {
        const u = JSON.parse(raw);
        setMyId(u.userId ?? u.id);
      }
    });
    fetchListing();
  }, [id]);

  const fetchListing = useCallback(async () => {
    setLoading(true);
    try {
      const token     = await getToken();
      const viewerKey = await getMarketViewerKey();
      const r     = await fetch(`${API_URL}/api/market/${id}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Viewer-Key': viewerKey,
        },
      });
      if (!r.ok) throw new Error('Błąd pobierania');
      const data = await r.json();
      setListing(data);
    } catch (e) {
      console.error('fetchListing:', e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchInquiries = useCallback(async (listingId: number) => {
    setLoadingInquiries(true);
    try {
      const token = await getToken();
      const r     = await fetch(`${API_URL}/api/market/${listingId}/conversations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) setInquiries(await r.json());
    } catch (e) {
      console.error('fetchInquiries:', e);
    } finally {
      setLoadingInquiries(false);
    }
  }, []);

  useEffect(() => {
    if (!listing || myId === null || listing.seller.id !== myId) {
      setInquiries([]);
      return;
    }
    fetchInquiries(listing.id);
  }, [listing, myId, fetchInquiries]);

  const handleContact = async () => {
    if (!listing) return;
    setContacting(true);
    try {
      const token = await getToken();
      const r     = await fetch(`${API_URL}/api/market/${listing.id}/conversations`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error('Błąd tworzenia konwersacji');
      const data = await r.json();
      router.push({ pathname: '/Community/market/chat/[convId]', params: { convId: String(data.id) } } as any);
    } catch (e) {
      console.error('handleContact:', e);
      Toast.show({ type: 'error', text1: 'Błąd', text2: 'Nie można nawiązać kontaktu' });
    } finally {
      setContacting(false);
    }
  };

  const handleDelete = () => {
    Alert.alert(
      'Usuń ogłoszenie',
      'Czy na pewno chcesz usunąć to ogłoszenie?',
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Usuń',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              const token = await getToken();
              const r     = await fetch(`${API_URL}/api/market/${listing!.id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
              });
              if (!r.ok) throw new Error();
              Toast.show({ type: 'success', text1: '🗑️ Ogłoszenie usunięte' });
              router.back();
            } catch {
              Toast.show({ type: 'error', text1: 'Błąd usuwania' });
            } finally {
              setDeleting(false);
            }
          },
        },
      ],
    );
  };

  const handlePromote = async (duration: 'week' | 'month') => {
    if (!listing) return;
    router.push({
      pathname: '/Community/market/fee-checkout',
      params: {
        kind: 'promote',
        listingId: String(listing.id),
        duration,
      },
    } as any);
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.primary} size="large" />
      </View>
    );
  }

  if (!listing) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <MaterialCommunityIcons name="tag-off-outline" size={52} color={theme.border3} />
        <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 14 }}>Ogłoszenie nie istnieje</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ paddingHorizontal: 20, paddingVertical: 10, backgroundColor: theme.primary, borderRadius: 12 }}>
          <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 10, fontWeight: '700' }}>WRÓĆ</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isOwner = myId !== null && listing.seller.id === myId;

  const specRows: Array<{ icon: string; label: string; value: string | null | undefined }> = [
    { icon: 'car-outline',            label: 'Marka',      value: listing.brand },
    { icon: 'car-info',               label: 'Model',      value: listing.model },
    { icon: 'calendar-outline',       label: 'Rok',        value: listing.year?.toString() },
    { icon: 'speedometer',            label: 'Przebieg',   value: listing.mileage != null ? `${listing.mileage.toLocaleString('pl-PL')} km` : null },
    { icon: 'engine-outline',         label: 'Moc',        value: listing.power != null ? `${listing.power} KM` : null },
    { icon: 'car-traction-control',   label: 'Napęd',      value: listing.drive },
    { icon: 'cog-outline',            label: 'Skrzynia',   value: listing.transmission },
    { icon: 'palette-outline',        label: 'Kolor',      value: listing.color },
    { icon: 'gas-station-outline',    label: 'Paliwo',     value: listing.fuelType || listing.fuel },
  ].filter(r => !!r.value);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />

      <CommunityScreenHeader
        breadcrumb="GIEŁDA"
        title={listing.title}
        subtitle={`${listing.price?.toLocaleString('pl-PL') ?? '—'} PLN`}
      />

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Photo gallery */}
        {listing.photos.length > 0 ? (
          <View>
            <FlatList
              data={listing.photos}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              removeClippedSubviews={false}
              keyExtractor={(_, i) => String(i)}
              getItemLayout={(_, index) => ({
                length: SCREEN_W,
                offset: SCREEN_W * index,
                index,
              })}
              onMomentumScrollEnd={e => {
                const w = e.nativeEvent.layoutMeasurement.width || SCREEN_W;
                const idx = Math.round(e.nativeEvent.contentOffset.x / w);
                setActivePhotoIdx(Math.max(0, Math.min(idx, listing.photos.length - 1)));
              }}
              renderItem={({ item }) => (
                <View style={{ width: SCREEN_W, height: GALLERY_H, backgroundColor: theme.surface2, overflow: 'hidden' }}>
                  <Image
                    source={{ uri: item }}
                    style={{ width: SCREEN_W, height: GALLERY_H }}
                    contentFit="cover"
                    transition={0}
                  />
                </View>
              )}
            />
            {/* Dots */}
            {listing.photos.length > 1 && (
              <View style={{ position: 'absolute', bottom: 10, alignSelf: 'center', flexDirection: 'row', gap: 6 }}>
                {listing.photos.map((_, i) => (
                  <View key={i} style={{ width: i === activePhotoIdx ? 20 : 6, height: 6, borderRadius: 3, backgroundColor: i === activePhotoIdx ? '#fff' : '#ffffff60' }} />
                ))}
              </View>
            )}
          </View>
        ) : (
          <View style={{ width: '100%', height: 200, backgroundColor: theme.surface2, alignItems: 'center', justifyContent: 'center' }}>
            <MaterialCommunityIcons name="car-outline" size={60} color={theme.border3} />
          </View>
        )}

        <View style={{ padding: 20, gap: 20 }}>
          {/* Title + price */}
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ backgroundColor: theme.primaryBg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: theme.primaryBorder }}>
                <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 8, fontWeight: '700' }}>{listing.category.toUpperCase()}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <MaterialCommunityIcons name="eye-outline" size={12} color={theme.textDim} />
                <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 8 }}>
                  {listing.viewsCount ?? listing.views ?? 0} wyświetleń
                </Text>
              </View>
            </View>
            <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 18, fontWeight: '900', lineHeight: 26 }}>
              {listing.title}
            </Text>
            <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 24, fontWeight: '900' }}>
              {formatPrice(listing.price)}
            </Text>
            {!!listing.location && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <MaterialCommunityIcons name="map-marker" size={16} color={theme.primary} />
                <Text style={{ color: theme.textMuted, fontFamily: 'Orbitron', fontSize: 11 }}>
                  {listing.location}
                </Text>
              </View>
            )}
          </View>

          {/* Specs */}
          {specRows.length > 0 && (
            <View style={{ backgroundColor: theme.surface, borderRadius: 16, borderWidth: 1, borderColor: theme.border, overflow: 'hidden' }}>
              <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.border }}>
                <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 12, fontWeight: '700', letterSpacing: 1 }}>SPECYFIKACJA</Text>
              </View>
              {specRows.map((row, i) => (
                <View key={row.label} style={{
                  flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12,
                  borderBottomWidth: i < specRows.length - 1 ? 1 : 0, borderBottomColor: theme.border,
                }}>
                  <MaterialCommunityIcons name={row.icon as any} size={16} color={theme.primary} />
                  <Text style={{ flex: 1, color: theme.textDim, fontFamily: 'Orbitron', fontSize: 10, marginLeft: 10 }}>{row.label}</Text>
                  <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 11, fontWeight: '700' }}>{row.value}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Description */}
          {!!listing.description && (
            <View style={{ gap: 10 }}>
              <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 12, fontWeight: '700', letterSpacing: 1 }}>OPIS</Text>
              <Text style={{ color: theme.textMuted, fontSize: 14, lineHeight: 22 }}>{listing.description}</Text>
            </View>
          )}

          {/* Seller */}
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => openUserProfile(listing.seller.id)}
            style={{
              backgroundColor: theme.surface, borderRadius: 16, borderWidth: 1, borderColor: theme.border,
              padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14,
            }}
          >
            <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: theme.primaryBg, borderWidth: 2, borderColor: theme.primaryBorder, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
              {listing.seller.avatarUrl
                ? <Image source={{ uri: listing.seller.avatarUrl }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                : <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 16, fontWeight: '900' }}>{listing.seller.username.charAt(0).toUpperCase()}</Text>
              }
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 8, letterSpacing: 1 }}>SPRZEDAJĄCY</Text>
              <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 14, fontWeight: '700' }}>@{listing.seller.username}</Text>
              <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 8, marginTop: 4 }}>Zobacz profil</Text>
            </View>
            <Feather name="chevron-right" size={20} color={theme.textDim} />
          </TouchableOpacity>

          {/* Action buttons */}
          {isOwner ? (
            <View style={{ gap: 12, paddingBottom: 20 }}>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <TouchableOpacity
                  style={{ flex: 1, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, borderColor: theme.primary, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
                  onPress={() => router.push({ pathname: '/Community/market/add', params: { editId: String(listing.id) } } as any)}
                >
                  <Feather name="edit-2" size={16} color={theme.primary} />
                  <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 11, fontWeight: '700' }}>EDYTUJ</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ flex: 1, paddingVertical: 14, borderRadius: 14, backgroundColor: '#e3383520', borderWidth: 1.5, borderColor: '#e3383540', alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
                  onPress={handleDelete}
                  disabled={deleting}
                >
                  {deleting
                    ? <ActivityIndicator size="small" color="#e33835" />
                    : <>
                        <Feather name="trash-2" size={16} color="#e33835" />
                        <Text style={{ color: '#e33835', fontFamily: 'Orbitron', fontSize: 11, fontWeight: '700' }}>USUŃ</Text>
                      </>
                  }
                </TouchableOpacity>
              </View>

              <View style={{ backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.border, padding: 14, gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>
                    WIADOMOŚCI ({inquiries.length})
                  </Text>
                  {loadingInquiries && <ActivityIndicator size="small" color={theme.primary} />}
                </View>
                {inquiries.length === 0 && !loadingInquiries ? (
                  <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9 }}>
                    Brak wiadomości od zainteresowanych.
                  </Text>
                ) : (
                  inquiries.map(conv => {
                    const last = conv.messages?.[0];
                    const preview = last?.content?.trim()
                      || (last ? 'Zdjęcie' : 'Brak wiadomości');
                    return (
                      <View
                        key={conv.id}
                        style={{
                          flexDirection: 'row', alignItems: 'center', gap: 12,
                          paddingVertical: 10, borderTopWidth: 1, borderTopColor: theme.border,
                        }}
                      >
                        <TouchableOpacity
                          onPress={() => openUserProfile(conv.buyer.id)}
                          activeOpacity={0.85}
                          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.primaryBg, borderWidth: 1, borderColor: theme.primaryBorder, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}
                        >
                          {conv.buyer.avatarUrl
                            ? <Image source={{ uri: conv.buyer.avatarUrl }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                            : <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 12, fontWeight: '700' }}>{conv.buyer.username.charAt(0).toUpperCase()}</Text>
                          }
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={{ flex: 1, gap: 3 }}
                          activeOpacity={0.85}
                          onPress={() => router.push({
                            pathname: '/Community/market/chat/[convId]',
                            params: { convId: String(conv.id) },
                          } as any)}
                        >
                          <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 11, fontWeight: '700' }} numberOfLines={1}>
                            @{conv.buyer.username}
                          </Text>
                          <Text style={{ color: theme.textDim, fontSize: 12 }} numberOfLines={1}>{preview}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => router.push({
                            pathname: '/Community/market/chat/[convId]',
                            params: { convId: String(conv.id) },
                          } as any)}
                        >
                          <MaterialCommunityIcons name="chevron-right" size={20} color={theme.textDim} />
                        </TouchableOpacity>
                      </View>
                    );
                  })
                )}
              </View>

              <View style={{ backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.border, padding: 12, gap: 10 }}>
                <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 8, letterSpacing: 1 }}>
                  {listing.isPromoted ? 'PROMOWANIE AKTYWNE' : 'PROMUJ OGŁOSZENIE'}
                </Text>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity
                    style={{ flex: 1, paddingVertical: 11, borderRadius: 10, backgroundColor: '#268bff20', borderWidth: 1, borderColor: '#268bff40', alignItems: 'center' }}
                    onPress={() => handlePromote('week')}
                    disabled={promoting}
                  >
                    <Text style={{ color: '#268bff', fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700' }}>
                      {promoting ? '...' : '7 DNI'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ flex: 1, paddingVertical: 11, borderRadius: 10, backgroundColor: '#FFD70020', borderWidth: 1, borderColor: '#FFD70040', alignItems: 'center' }}
                    onPress={() => handlePromote('month')}
                    disabled={promoting}
                  >
                    <Text style={{ color: '#FFD700', fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700' }}>
                      {promoting ? '...' : '30 DNI'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ) : (
            <View style={{ gap: 10, marginBottom: 20 }}>
              {listing.status && listing.status !== 'active' && (
                <View style={{
                  backgroundColor: theme.surface,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: theme.border,
                  padding: 12,
                }}
                >
                  <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 10 }}>
                    {listing.status === 'reserved' ? 'ZAREZERWOWANE — TRWA ZAKUP / ESCROW'
                      : listing.status === 'sold' ? 'SPRZEDANE'
                        : 'NIEDOSTĘPNE'}
                  </Text>
                </View>
              )}
              {listing.status === 'active' && (
                <TouchableOpacity
                  style={{
                    paddingVertical: 16, borderRadius: 16, backgroundColor: theme.primary,
                    alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 10,
                    shadowColor: theme.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 8,
                  }}
                  onPress={() => router.push({ pathname: '/Community/market/checkout', params: { id: String(listing.id) } } as any)}
                >
                  <MaterialCommunityIcons name="cart-outline" size={20} color="#fff" />
                  <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 12, fontWeight: '700', letterSpacing: 1 }}>
                    KUP TERAZ
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={{
                  paddingVertical: 14, borderRadius: 14, backgroundColor: theme.surface,
                  alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 10,
                  borderWidth: 1, borderColor: theme.border,
                }}
                onPress={handleContact}
                disabled={contacting}
              >
                {contacting
                  ? <ActivityIndicator color={theme.primary} />
                  : <>
                      <MaterialCommunityIcons name="message-text-outline" size={18} color={theme.text} />
                      <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>
                        NAPISZ DO SPRZEDAJĄCEGO
                      </Text>
                    </>
                }
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
