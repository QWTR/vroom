import React, { useCallback } from 'react';
import {
  StatusBar,
  TouchableOpacity,
  View,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../../contexts/ThemeContext';
import { CommunityScreenHeader } from '../../../components/community';
import { TabAuta } from '../community/TabAuta';
import { useVroomkiFeed } from '../../../hooks/useVroomkiFeed';
import { consumeVroomkiFocusPostId } from '../../../lib/vroomkiTypes';
import { ErrorBoundary } from '../../../components/ErrorBoundary';

const LAST_PUBLISHED_POST_KEY = 'vroomki_last_published_post_id';

export default function VroomkiScreen() {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isFocused = useIsFocused();
  const params = useLocalSearchParams<{ vroomkiId?: string; userId?: string; q?: string }>();

  const initialId = params.vroomkiId ? parseInt(String(params.vroomkiId), 10) : null;
  const authorUserId = params.userId ? parseInt(String(params.userId), 10) : null;
  const searchQuery = String(params.q ?? '').trim() || null;

  const {
    myId,
    posts,
    focusPostId,
    loadingC,
    refreshingC,
    loadingMoreC,
    hasMoreC,
    refresh,
    loadMore,
    like,
    create,
    remove,
    report,
    blockAuthor,
    trackView,
    markCommentAdded,
    followAuthor,
    focusOnPost,
  } = useVroomkiFeed(
    Number.isFinite(initialId ?? NaN) ? initialId : null,
    null,
    Number.isFinite(authorUserId ?? NaN) ? authorUserId : null,
    searchQuery,
  );

  const openSearch = useCallback(() => {
    router.push('/Community/vroomki/search' as any);
  }, [router]);

  const openMyVroomkiProfile = useCallback(() => {
    if (!myId) return;
    router.push({ pathname: '/Community/vroomki/profile/[userId]', params: { userId: String(myId) } } as any);
  }, [myId, router]);

  useFocusEffect(
    useCallback(() => {
      const publishedId = consumeVroomkiFocusPostId();
      if (publishedId && Number.isFinite(publishedId)) {
        void focusOnPost(publishedId);
        void AsyncStorage.removeItem(LAST_PUBLISHED_POST_KEY);
        return;
      }

      void (async () => {
        const storedId = parseInt((await AsyncStorage.getItem(LAST_PUBLISHED_POST_KEY)) ?? '', 10);
        if (Number.isFinite(storedId)) {
          await AsyncStorage.removeItem(LAST_PUBLISHED_POST_KEY);
          await focusOnPost(storedId);
        }
      })();
    }, [focusOnPost]),
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={['left', 'right', 'bottom']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <CommunityScreenHeader
        title={
          searchQuery
            ? 'WYNIKI SZUKANIA'
            : Number.isFinite(authorUserId ?? NaN)
            ? 'VROOMKI PROFIL'
            : 'VROOMKI'
        }
        subtitle={searchQuery ?? undefined}
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity
              onPress={openSearch}
              style={{
                width: 42,
                height: 42,
                borderRadius: 21,
                backgroundColor: theme.surface,
                borderWidth: 1,
                borderColor: theme.border,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <MaterialIcons name="search" size={22} color={theme.text} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={openMyVroomkiProfile}
              disabled={!myId}
              style={{
                width: 42,
                height: 42,
                borderRadius: 21,
                backgroundColor: '#e33835',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: myId ? 1 : 0.45,
              }}
            >
              <MaterialIcons name="person" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
        }
      />
      <View style={{ flex: 1 }}>
        <ErrorBoundary
          vroomkiOnly
          fallbackTitle="Nie udało się otworzyć Rolek"
          onRecovered={() => { void refresh(); }}
        >
          <TabAuta
            posts={posts}
            focusPostId={focusPostId}
            myId={myId}
            loadingC={loadingC}
            loadingMoreC={loadingMoreC}
            refreshingC={refreshingC}
            hasMoreC={hasMoreC}
            onLike={like}
            onCreate={create}
            onDelete={remove}
            onReport={report}
            onBlock={blockAuthor}
            onView={trackView}
            onCommentAdded={markCommentAdded}
            onFollowAuthor={followAuthor}
            onRefresh={refresh}
            onLoadMore={loadMore}
            bottomInset={insets.bottom}
            router={router}
            feedActive={isFocused}
          />
        </ErrorBoundary>
      </View>
    </SafeAreaView>
  );
}
