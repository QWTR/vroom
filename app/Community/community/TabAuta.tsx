import React, { useState, useEffect } from 'react';
import {
  View, Text, Image, TouchableOpacity, FlatList, RefreshControl,
  Modal, Pressable, ActivityIndicator,
} from 'react-native';
import { formatDistanceToNow } from 'date-fns';
import { pl }                  from 'date-fns/locale';
import { useTheme }            from '../../../contexts/ThemeContext';
import { useRouter }           from 'expo-router';
import { API_URL }             from '../../../constants/config';
import AsyncStorage            from '@react-native-async-storage/async-storage';
import Toast                   from 'react-native-toast-message';
import MaterialIcons           from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons  from '@expo/vector-icons/MaterialCommunityIcons';
import { type CommunityCar, Avatar, ListFooter } from './communityShared';

// ─────────────────────────────────────────────────────────
// CAR CARD — pełna szerokość
// ─────────────────────────────────────────────────────────
const CarCard = React.memo(({ car, myId, onLike, onPress, onProfile }: {
  car: CommunityCar; myId: number | null;
  onLike: (id: number) => void;
  onPress: (c: CommunityCar) => void;
  onProfile: (id: number) => void;
}) => {
  const { theme } = useTheme();
  const time = formatDistanceToNow(new Date(car.createdAt), { addSuffix: true, locale: pl });
  return (
    <View style={{
      marginHorizontal: 12, marginBottom: 12,
      backgroundColor: theme.surface,
      borderRadius: 20, borderWidth: 1, borderColor: theme.border2,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 14, paddingBottom: 10 }}>
        <TouchableOpacity onPress={() => onProfile(car.owner.id)}>
          <Avatar user={car.owner} size={42} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <TouchableOpacity onPress={() => onProfile(car.owner.id)}>
            <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 12, fontWeight: '700' }}>
              {car.owner.username}
            </Text>
          </TouchableOpacity>
          <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 8, marginTop: 2 }}>{time}</Text>
        </View>
        {car.isMain && (
          <View style={{ backgroundColor: '#FFD70020', borderRadius: 10, borderWidth: 1, borderColor: '#FFD70050', paddingHorizontal: 8, paddingVertical: 4 }}>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#FFD700' }}>GŁÓWNE</Text>
          </View>
        )}
      </View>

      {/* Zdjęcie pełna szerokość */}
      <TouchableOpacity activeOpacity={0.9} onPress={() => onPress(car)}>
        {car.photos.length > 0 ? (
          <View>
            <Image source={{ uri: car.photos[0] }} style={{ width: '100%', height: 200 }} resizeMode="cover" />
            {car.photos.length > 1 && (
              <View style={{
                position: 'absolute', bottom: 10, right: 10,
                backgroundColor: '#000000bb', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4,
                flexDirection: 'row', alignItems: 'center', gap: 4,
              }}>
                <MaterialIcons name="photo-library" size={11} color="#fff" />
                <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#fff' }}>{car.photos.length}</Text>
              </View>
            )}
          </View>
        ) : (
          <View style={{
            width: '100%', height: 160, backgroundColor: '#e3383510',
            justifyContent: 'center', alignItems: 'center',
          }}>
            <MaterialIcons name="directions-car" size={64} color="#e3383540" />
          </View>
        )}
      </TouchableOpacity>

      {/* Info */}
      <View style={{ padding: 14 }}>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 16, color: theme.text, fontWeight: '700', marginBottom: 3 }}>{car.brand}</Text>
        <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: '#e33835', marginBottom: 10 }}>{car.specs}</Text>

        {/* Footer */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: theme.border }}>
          <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }} onPress={() => onLike(car.id)}>
            <MaterialCommunityIcons name={car.isLiked ? 'heart' : 'heart-outline'} size={18}
              color={car.isLiked ? '#e33835' : theme.textDim} />
            <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: car.isLiked ? '#e33835' : theme.textDim }}>{car.likesCount}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }} onPress={() => onPress(car)}>
            <MaterialCommunityIcons name="comment-outline" size={18} color={theme.textDim} />
            <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.textDim }}>{car.commentsCount}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5 }}
            onPress={() => onPress(car)}>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim }}>SZCZEGÓŁY</Text>
            <MaterialIcons name="arrow-forward-ios" size={11} color={theme.textDim} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
});

// ─────────────────────────────────────────────────────────
// GARAGE PICKER MODAL
// ─────────────────────────────────────────────────────────
interface GarageCar {
  id: number;
  brand: string;
  specs: string;
  isMain: boolean;
  photos: string[];
  sharedToCommunity: boolean;
}

function GaragePickerModal({ visible, onClose, onShareToggle }: {
  visible: boolean;
  onClose: () => void;
  onShareToggle: () => void;
}) {
  const { theme } = useTheme();
  const router = useRouter();
  const [garageCars, setGarageCars] = useState<GarageCar[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [toggling,   setToggling]   = useState<number | null>(null);

  useEffect(() => {
    if (!visible) return;
    (async () => {
      setLoading(true);
      try {
        const token = await AsyncStorage.getItem('token');
        const res = await fetch(`${API_URL}/api/cars`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
          const data = await res.json();
          setGarageCars(Array.isArray(data) ? data : data.cars ?? []);
        } else {
          const meRes = await fetch(`${API_URL}/api/profile/me`, { headers: { Authorization: `Bearer ${token}` } });
          const me = await meRes.json();
          const uid = me.userId ?? me.id;
          const carsRes = await fetch(`${API_URL}/api/profile/${uid}/cars`, { headers: { Authorization: `Bearer ${token}` } });
          const carsData = await carsRes.json();
          setGarageCars(Array.isArray(carsData) ? carsData : []);
        }
      } catch { Toast.show({ type: 'error', text1: 'Błąd ładowania garażu' }); } finally { setLoading(false); }
    })();
  }, [visible]);

  const handleToggle = async (car: GarageCar) => {
    setToggling(car.id);
    try {
      const token = await AsyncStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/cars/${car.id}/share-community`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setGarageCars(prev => prev.map(c => c.id === car.id ? { ...c, sharedToCommunity: data.sharedToCommunity } : c));
      Toast.show({
        type: 'success',
        text1: data.sharedToCommunity ? '🚗 DODANO DO SPOŁECZNOŚCI' : 'UKRYTO',
        text2: data.sharedToCommunity ? car.brand : '',
      });
      onShareToggle();
    } catch {
      Toast.show({ type: 'error', text1: 'Nie udało się zaktualizować statusu auta' });
    } finally { setToggling(null); }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={{ flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={{
          backgroundColor: theme.surface,
          borderTopLeftRadius: 28, borderTopRightRadius: 28,
          maxHeight: '80%',
          borderTopWidth: 1, borderColor: theme.border2,
          paddingHorizontal: 16, paddingBottom: 32,
        }}>
          {/* Handle */}
          <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: theme.border3, alignSelf: 'center', marginTop: 12, marginBottom: 16 }} />

          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <MaterialIcons name="garage" size={20} color="#e33835" />
            <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: theme.text, letterSpacing: 2, flex: 1 }}>TWÓJ GARAŻ</Text>
            <TouchableOpacity
              style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: theme.surface2, justifyContent: 'center', alignItems: 'center' }}
              onPress={onClose}
            >
              <MaterialIcons name="close" size={16} color={theme.textDim} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <ActivityIndicator color="#e33835" style={{ marginVertical: 40 }} />
          ) : garageCars.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 40, gap: 16 }}>
              <MaterialIcons name="directions-car" size={48} color="#e3383530" />
              <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 10, letterSpacing: 1 }}>BRAK AUT W GARAŻU</Text>
              <TouchableOpacity
                style={{
                  backgroundColor: '#e33835', borderRadius: 12,
                  paddingHorizontal: 20, paddingVertical: 12,
                  flexDirection: 'row', alignItems: 'center', gap: 8,
                }}
                onPress={() => { onClose(); router.push('/profile/add-car' as any); }}
              >
                <MaterialIcons name="add" size={16} color="#fff" />
                <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: '#fff' }}>DODAJ AUTO</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <FlatList
              data={garageCars}
              keyExtractor={c => String(c.id)}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ gap: 10, paddingBottom: 8 }}
              renderItem={({ item: car }) => {
                const isToggling = toggling === car.id;
                return (
                  <View style={{
                    flexDirection: 'row', alignItems: 'center', gap: 12,
                    backgroundColor: theme.surface2, borderRadius: 16, padding: 12,
                    borderWidth: 1, borderColor: car.sharedToCommunity ? '#e3383530' : theme.border,
                  }}>
                    {/* Zdjęcie */}
                    {car.photos.length > 0 ? (
                      <Image source={{ uri: car.photos[0] }} style={{ width: 60, height: 60, borderRadius: 10 }} resizeMode="cover" />
                    ) : (
                      <View style={{ width: 60, height: 60, borderRadius: 10, backgroundColor: '#e3383510', justifyContent: 'center', alignItems: 'center' }}>
                        <MaterialIcons name="directions-car" size={28} color="#e3383540" />
                      </View>
                    )}

                    {/* Info */}
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: theme.text, fontWeight: '700' }} numberOfLines={1}>{car.brand}</Text>
                        {car.isMain && (
                          <View style={{ backgroundColor: '#FFD70020', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 }}>
                            <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: '#FFD700' }}>GŁÓWNE</Text>
                          </View>
                        )}
                      </View>
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim }} numberOfLines={1}>{car.specs}</Text>
                    </View>

                    {/* Toggle button */}
                    <TouchableOpacity
                      style={[{
                        borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
                        flexDirection: 'row', alignItems: 'center', gap: 5,
                        minWidth: 80, justifyContent: 'center',
                      }, car.sharedToCommunity
                        ? { backgroundColor: '#e3383515', borderWidth: 1, borderColor: '#e3383530' }
                        : { backgroundColor: '#e33835' }
                      ]}
                      onPress={() => handleToggle(car)}
                      disabled={isToggling}
                    >
                      {isToggling ? (
                        <ActivityIndicator size={14} color={car.sharedToCommunity ? '#e33835' : '#fff'} />
                      ) : (
                        <>
                          <MaterialIcons
                            name={car.sharedToCommunity ? 'visibility-off' : 'add'}
                            size={13}
                            color={car.sharedToCommunity ? '#e33835' : '#fff'}
                          />
                          <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: car.sharedToCommunity ? '#e33835' : '#fff', fontWeight: '700' }}>
                            {car.sharedToCommunity ? 'UKRYJ' : 'DODAJ'}
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                );
              }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────
// TAB AUTA
// ─────────────────────────────────────────────────────────
export function TabAuta({ cars, myId, loadingC, refreshingC, loadingMoreC,
  onLike, onRefresh, onLoadMore, onShareCar, bottomInset, router }: {
  cars: CommunityCar[];
  myId: number | null;
  loadingC: boolean;
  refreshingC: boolean;
  loadingMoreC: boolean;
  onLike: (id: number) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onShareCar: () => void;
  bottomInset: number;
  router: ReturnType<typeof useRouter>;
}) {
  const [garageVisible, setGarageVisible] = useState(false);

  const Header = () => (
    <TouchableOpacity
      style={{
        marginHorizontal: 12, marginVertical: 10,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 8, paddingVertical: 14,
        backgroundColor: '#e3383515', borderRadius: 16,
        borderWidth: 1.5, borderColor: '#e3383545', borderStyle: 'dashed',
      }}
      onPress={() => setGarageVisible(true)}
    >
      <MaterialIcons name="add" size={20} color="#e33835" />
      <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: '#e33835', letterSpacing: 2 }}>
        DODAJ SWOJE AUTO
      </Text>
    </TouchableOpacity>
  );

  return (
    <>
      <FlatList
        data={cars}
        keyExtractor={c => String(c.id)}
        renderItem={({ item }) => (
          <CarCard
            car={item} myId={myId} onLike={onLike}
            onPress={c => router.push({ pathname: '/profile/car-detail', params: { id: String(c.id) } })}
            onProfile={id => router.push({ pathname: '/profile/[userId]', params: { userId: String(id) } })}
          />
        )}
        ListHeaderComponent={<Header />}
        refreshControl={<RefreshControl refreshing={refreshingC} onRefresh={onRefresh} tintColor="#e33835" />}
        onEndReached={onLoadMore}
        onEndReachedThreshold={0.4}
        ListFooterComponent={<ListFooter loading={loadingMoreC} />}
        contentContainerStyle={{ paddingTop: 4, paddingBottom: Math.max(bottomInset, 20) }}
      />
      <GaragePickerModal
        visible={garageVisible}
        onClose={() => setGarageVisible(false)}
        onShareToggle={() => { setGarageVisible(false); onShareCar(); }}
      />
    </>
  );
}
