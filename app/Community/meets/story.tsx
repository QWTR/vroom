import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, Image, ActivityIndicator, TouchableOpacity, ScrollView, useWindowDimensions,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { captureRef } from 'react-native-view-shot';
import { saveOrShareImage } from '../../../lib/saveImage';
import { useTheme } from '../../../contexts/ThemeContext';
import { API_URL } from '../../../constants/config';
import { CommunityScreenHeader } from '../../../components/community';
import {
  MeetParticipantStoryCard,
  STORY_W,
  STORY_H,
  StoryCarInfo,
  StoryMeetInfo,
} from '../../../components/meets/MeetParticipantStoryCard';

interface Application {
  userId: number;
  user: { username: string; avatarUrl: string | null };
  car: StoryCarInfo | null;
  participantStatus: string;
}

export default function MeetStoryScreen() {
  const router = useRouter();
  const { id, userId } = useLocalSearchParams<{ id: string; userId: string }>();
  const { theme } = useTheme();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const shotRef = useRef<View>(null);

  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [meet, setMeet] = useState<StoryMeetInfo | null>(null);
  const [username, setUsername] = useState('');
  const [car, setCar] = useState<StoryCarInfo | null>(null);
  const [carReady, setCarReady] = useState(false);
  const [saving, setSaving] = useState(false);

  const previewScale = Math.min((screenW - 32) / STORY_W, (screenH - 280) / STORY_H, 0.42);

  const getToken = async () =>
    (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token')) ?? '';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const headers = { Authorization: `Bearer ${token}` };

      const [meetRes, appRes] = await Promise.all([
        fetch(`${API_URL}/api/meets/${id}`, { headers }),
        fetch(`${API_URL}/api/meets/${id}/participant-applications?status=approved&userId=${userId}&limit=1`, { headers }),
      ]);

      const meetData = await meetRes.json();
      const appData = await appRes.json();

      if (!meetRes.ok) throw new Error(meetData.error || 'Nie znaleziono wydarzenia');
      if (!appRes.ok) throw new Error(appData.error || 'Brak dostępu');

      const app: Application | undefined = appData.items?.[0];
      if (!app || app.participantStatus !== 'approved') {
        throw new Error('Brak zaakceptowanego uczestnika');
      }
      if (!app.car) throw new Error('Uczestnik nie ma przypisanego auta');

      setMeet({
        title: meetData.title,
        date: meetData.date,
        locationName: meetData.locationName,
      });
      setUsername(app.user.username);
      setCar({
        brand: app.car.brand,
        specs: app.car.specs,
        photos: Array.isArray(app.car.photos) ? app.car.photos.filter(Boolean) : [],
        year: app.car.year,
        power: app.car.power,
        color: app.car.color,
      });
      setCarReady(false);
      setImageUri(null);
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: e.message });
      router.back();
    } finally {
      setLoading(false);
    }
  }, [id, userId, router]);

  useEffect(() => { load(); }, [load]);

  const generateImage = useCallback(async () => {
    if (!shotRef.current || !meet || !car) return;
    setGenerating(true);
    try {
      await new Promise(r => setTimeout(r, 150));
      const uri = await captureRef(shotRef, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
        width: STORY_W,
        height: STORY_H,
      });
      setImageUri(uri);
    } catch {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Nie udało się wygenerować grafiki' });
    } finally {
      setGenerating(false);
    }
  }, [meet, car]);

  useEffect(() => {
    if (carReady && meet && car && !imageUri && !generating) {
      generateImage();
    }
  }, [carReady, meet, car, imageUri, generating, generateImage]);

  const saveToGallery = async () => {
    if (!imageUri) return;
    setSaving(true);
    try {
      const result = await saveOrShareImage(imageUri);
      if (result === 'saved') {
        Toast.show({ type: 'success', text1: 'ZAPISANO', text2: 'Grafika jest w galerii — wrzuć na Instagram Story!' });
      } else if (result === 'shared') {
        Toast.show({ type: 'success', text1: 'GOTOWE', text2: 'Wybierz Instagram Story lub Zapisz zdjęcie' });
      }
    } catch {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Nie udało się zapisać grafiki' });
    } finally {
      setSaving(false);
    }
  };

  const shareImage = async () => {
    if (!imageUri) return;
    setSaving(true);
    try {
      const result = await saveOrShareImage(imageUri);
      if (result === 'cancelled') return;
      Toast.show({ type: 'success', text1: 'GOTOWE', text2: 'Wybierz Instagram Story lub Zapisz zdjęcie' });
    } catch {
      Toast.show({ type: 'error', text1: 'BŁĄD', text2: 'Nie udało się udostępnić' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <CommunityScreenHeader title="STORY INSTAGRAM" subtitle="Grafika 9:16 gotowa do publikacji" />

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, alignItems: 'center' }}>
          {/* Podgląd */}
          <View
            style={{
              width: STORY_W * previewScale,
              height: STORY_H * previewScale,
              borderRadius: 16,
              overflow: 'hidden',
              borderWidth: 2,
              borderColor: theme.primary + '60',
              marginBottom: 20,
              backgroundColor: '#050505',
            }}
          >
            {imageUri ? (
              <Image source={{ uri: imageUri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            ) : (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                <ActivityIndicator size="large" color={theme.primary} />
                <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 10 }}>
                  {generating ? 'GENEROWANIE...' : 'ŁADOWANIE ZDJĘCIA...'}
                </Text>
              </View>
            )}
          </View>

          {!!username && (
            <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 10, marginBottom: 20, textAlign: 'center' }}>
              @{username} · {meet?.title}
            </Text>
          )}

          <TouchableOpacity
            onPress={saveToGallery}
            disabled={!imageUri || saving}
            style={{
              width: '100%',
              backgroundColor: theme.primary,
              borderRadius: 14,
              paddingVertical: 18,
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 10,
              opacity: !imageUri || saving ? 0.5 : 1,
              marginBottom: 12,
            }}
          >
            {saving
              ? <ActivityIndicator color="#fff" />
              : <>
                  <MaterialIcons name="file-download" size={22} color="#fff" />
                  <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 12, fontWeight: '700' }}>
                    POBIERZ GRAFIKĘ
                  </Text>
                </>
            }
          </TouchableOpacity>

          <TouchableOpacity
            onPress={shareImage}
            disabled={!imageUri}
            style={{
              width: '100%',
              backgroundColor: theme.surface,
              borderRadius: 14,
              paddingVertical: 18,
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 10,
              borderWidth: 1,
              borderColor: theme.border,
              opacity: !imageUri ? 0.5 : 1,
              marginBottom: 12,
            }}
          >
            <MaterialCommunityIcons name="share-variant" size={22} color={theme.text} />
            <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 12, fontWeight: '700' }}>
              UDOSTĘPNIJ
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={generateImage}
            disabled={generating || !car}
            style={{
              width: '100%',
              paddingVertical: 14,
              alignItems: 'center',
              opacity: generating ? 0.5 : 1,
            }}
          >
            <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 10 }}>
              ODŚWIEŻ PODGLĄD
            </Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* Ukryty renderer pełnej rozdzielczości */}
      {meet && car && (
        <View
          ref={shotRef}
          collapsable={false}
          style={{ position: 'absolute', top: -STORY_H - 100, left: 0, width: STORY_W, height: STORY_H }}
        >
          <MeetParticipantStoryCard
            meet={meet}
            username={username}
            car={car}
            onCarImageLoad={() => setCarReady(true)}
            onCarImageError={() => setCarReady(true)}
          />
        </View>
      )}
    </View>
  );
}
