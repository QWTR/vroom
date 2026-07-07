import React, { useCallback, useEffect, useState } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../../../contexts/ThemeContext';
import { API_URL } from '../../../../constants/config';
import { CommunityScreenHeader } from '../../../../components/community';
import { TabAuta } from '../../community/TabAuta';
import { useVroomkiFeed } from '../../../../hooks/useVroomkiFeed';
import { pickVroomkiMediaFromGallery } from '../../../../lib/pickVroomkiMedia';
import { setVroomkiDraft, type VroomkiSound } from '../../../../lib/vroomkiTypes';

const getToken = async () =>
  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));

export default function VroomkiSoundScreen() {
  const { theme, isDark } = useTheme();
  const router = useRouter();
  const isFocused = useIsFocused();
  const [pickingMedia, setPickingMedia] = useState(false);
  const params = useLocalSearchParams<{ id?: string }>();
  const soundId = params.id ? parseInt(String(params.id), 10) : null;

  const [sound, setSound] = useState<VroomkiSound | null>(null);
  const [loadingSound, setLoadingSound] = useState(true);

  useEffect(() => {
    if (isFocused) setPickingMedia(false);
  }, [isFocused]);

  const {
    myId,
    posts,
    loadingC,
    refreshingC,
    loadingMoreC,
    hasMoreC,
    refresh,
    loadMore,
    like,
    remove,
    report,
    blockAuthor,
    trackView,
    markCommentAdded,
    followAuthor,
  } = useVroomkiFeed(null, Number.isFinite(soundId ?? NaN) ? soundId : null);

  useEffect(() => {
    if (!Number.isFinite(soundId ?? NaN)) {
      setLoadingSound(false);
      return;
    }
    (async () => {
      setLoadingSound(true);
      try {
        const token = await getToken();
        const res = await fetch(`${API_URL}/api/vroomki/sounds/${soundId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error();
        setSound(await res.json());
      } catch {
        Toast.show({ type: 'error', text1: 'Nie znaleziono dźwięku' });
        router.back();
      } finally {
        setLoadingSound(false);
      }
    })();
  }, [soundId, router]);

  const useThisSound = useCallback(async () => {
    if (!sound) return;
    setPickingMedia(true);
    const picked = await pickVroomkiMediaFromGallery();
    if (!picked) {
      if (isFocused) setPickingMedia(false);
      return;
    }
    setVroomkiDraft({
      photos: picked.kind === 'photos' ? picked.photos : [],
      video: picked.kind === 'video' ? picked.video : null,
      overlays: [],
      sound,
      useOriginalAudio: false,
      soundStartMs: 0,
      photoDurationMs: 3000,
      clipStartMs: 0,
      clipDurationMs: null,
      preselectedSoundId: sound.id,
    });
    router.push('/Community/vroomki/create');
  }, [router, sound, isFocused]);

  if (loadingSound) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color="#e33835" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={['left', 'right', 'bottom']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <CommunityScreenHeader title="DŹWIĘK" />

      <View style={{ paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          {sound?.coverUrl ? (
            <Image source={{ uri: sound.coverUrl }} style={{ width: 64, height: 64, borderRadius: 14 }} />
          ) : (
            <View style={{ width: 64, height: 64, borderRadius: 14, backgroundColor: theme.surface2, justifyContent: 'center', alignItems: 'center' }}>
              <MaterialIcons name="music-note" size={28} color="#e33835" />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 14 }} numberOfLines={2}>{sound?.title}</Text>
            <Text style={{ color: theme.textDim, marginTop: 4 }} numberOfLines={1}>{sound?.artist}</Text>
            <Text style={{ color: theme.textDim, marginTop: 6, fontSize: 11 }}>
              {sound?.usageCount ?? 0} Vroomek z tym dźwiękiem
            </Text>
          </View>
        </View>

        <TouchableOpacity
          onPress={() => void useThisSound()}
          style={{
            marginTop: 14,
            backgroundColor: '#e33835',
            borderRadius: 16,
            paddingVertical: 13,
            alignItems: 'center',
          }}
        >
          <Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 12, fontWeight: '800' }}>UŻYJ TEGO DŹWIĘKU</Text>
        </TouchableOpacity>
      </View>

      <TabAuta
        posts={posts}
        myId={myId}
        loadingC={loadingC}
        refreshingC={refreshingC}
        loadingMoreC={loadingMoreC}
        hasMoreC={hasMoreC}
        onLike={like}
        onCreate={async () => {}}
        onDelete={remove}
        onReport={report}
        onBlock={blockAuthor}
        onView={trackView}
        onCommentAdded={markCommentAdded}
        onFollowAuthor={followAuthor}
        onRefresh={refresh}
        onLoadMore={loadMore}
        bottomInset={0}
        router={router}
        hideFab
        feedActive={isFocused && !pickingMedia}
      />
    </SafeAreaView>
  );
}
