import React, { useCallback } from 'react';
import {
  SafeAreaView,
  StatusBar,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../../contexts/ThemeContext';
import { CommunityScreenHeader } from '../../../components/community';
import { TabAuta } from '../community/TabAuta';
import { useVroomkiFeed } from '../../../hooks/useVroomkiFeed';
import { consumeVroomkiFocusPostId } from '../../../lib/vroomkiTypes';

export default function VroomkiScreen() {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ vroomkiId?: string }>();

  const initialId = params.vroomkiId ? parseInt(String(params.vroomkiId), 10) : null;

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
  } = useVroomkiFeed(Number.isFinite(initialId ?? NaN) ? initialId : null);

  useFocusEffect(
    useCallback(() => {
      const publishedId = consumeVroomkiFocusPostId();
      if (publishedId && Number.isFinite(publishedId)) {
        void focusOnPost(publishedId);
      }
    }, [focusOnPost]),
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={['left', 'right', 'bottom']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <CommunityScreenHeader
        title="VROOMKI"
      />
      <View style={{ flex: 1 }}>
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
        />
      </View>
    </SafeAreaView>
  );
}
