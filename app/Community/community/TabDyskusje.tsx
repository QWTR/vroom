import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  RefreshControl, Alert, ActivityIndicator, ScrollView,
} from 'react-native';
import AsyncStorage            from '@react-native-async-storage/async-storage';
import Toast                   from 'react-native-toast-message';
import { formatDistanceToNow } from 'date-fns';
import { pl }                  from 'date-fns/locale';
import { useTheme }            from '../../../contexts/ThemeContext';
import { API_URL }             from '../../../constants/config';
import { syncProfileClubFromServer } from '../../../lib/profileClubSync';
import { AdNativePost }         from '../../../components/ads/AdNativePost';
import { AdPostBoundary }       from '../../../components/ads/AdPostBoundary';
import { LinkPreviewCard }     from '@/components/chat/LinkPreviewCard';
import { RoutePreviewCard, parseRoutePostContent, type RoutePreviewData } from '../../../components/community/RoutePreviewCard';
import MaterialIcons           from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons  from '@expo/vector-icons/MaterialCommunityIcons';
import { UserBadges } from '../../../components/user/UserBadges';
import {
  type Post,
  type DiscussionCategoryFilter,
  type DiscussionCategoryId,
  DISCUSSION_ALL_CATEGORIES,
  DISCUSSION_CATEGORIES,
  getDiscussionCategoryMeta,
  Avatar, MediaGrid, DeleteModal, ActionBtn, ListFooter, ComposeBox,
  DiscussionPollCard, extractUrl, renderDiscussionBody, resolveMentionUserId,
  ReactionChips, DISCUSSION_REACTION_EMOJIS,
  type PostPollData, type PostPollInput,
} from './communityShared';

// ─────────────────────────────────────────────────────────
// POST CARD
// ─────────────────────────────────────────────────────────
const PostCard = React.memo(({
  post, myId, onLike, onRepost, onComment, onDelete, onProfile, onReport, onBlock, onPollVote,
  onReact, onOpenReactionPicker, onNavigateRoute, onHashtagPress,
}: {
  post: Post; myId: number | null;
  onLike: (id: number) => void;
  onRepost: (id: number) => void;
  onComment: (post: Post) => void;
  onDelete: (id: number) => void;
  onProfile: (id: number) => void;
  onReport: (post: Post, reason: string) => void;
  onBlock: (post: Post) => void;
  onPollVote: (postId: number, optionIdx: number) => Promise<PostPollData | null>;
  onReact: (postId: number, emoji: string) => void;
  onOpenReactionPicker: (post: Post) => void;
  onNavigateRoute?: (data: RoutePreviewData) => void;
  onHashtagPress?: (tag: string) => void;
}) => {
  const { theme, isDark } = useTheme();
  const [showDelete, setShowDelete] = useState(false);
  const [joiningClub, setJoiningClub] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const isOwn = post.author.id === myId;
  const time  = formatDistanceToNow(new Date(post.createdAt), { addSuffix: true, locale: pl });
  const getToken = () => AsyncStorage.getItem('token');

  function parseClubInviteMessage(content: string) {
    try {
      const parsed = JSON.parse(content);
      if (parsed?.type === 'clubInvite' && parsed?.clubId && parsed?.clubName) return parsed;
    } catch {}
    return null;
  }

  const routeData = parseRoutePostContent(post.content);
  const clubInviteData = parseClubInviteMessage(post.content);
  const clubInviteMessage = clubInviteData
    ? (typeof clubInviteData.message === 'string' ? clubInviteData.message.trim() : '')
    : '';
  const hasPoll   = !!post.poll;
  const plainText = clubInviteData ? clubInviteMessage : (hasPoll || routeData ? '' : post.content);
  const caption   = hasPoll ? post.content?.trim() : '';
  const linkUrl   = (!routeData && !clubInviteData && !hasPoll) ? extractUrl(post.content) : null;
  const categoryMeta = getDiscussionCategoryMeta(post.category);

  useEffect(() => {
    if (isOwn || !myId) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${API_URL}/api/follow/status/${post.author.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!cancelled && res.ok) {
          const data = await res.json();
          setIsFollowing(!!data.isFollowing);
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [post.author.id, isOwn, myId]);

  const handleFollowToggle = useCallback(async () => {
    if (isOwn || !myId) return;
    setFollowLoading(true);
    try {
      const token = await getToken();
      if (isFollowing) {
        const res = await fetch(`${API_URL}/api/follow/${post.author.id}`, {
          method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          setIsFollowing(false);
          Toast.show({ type: 'success', text1: 'Przestałeś obserwować' });
        }
      } else {
        const res = await fetch(`${API_URL}/api/follow/${post.author.id}`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          setIsFollowing(true);
          Toast.show({ type: 'success', text1: 'Obserwujesz!' });
        }
      }
    } catch {
      Toast.show({ type: 'error', text1: 'Błąd połączenia' });
    } finally {
      setFollowLoading(false);
    }
  }, [isFollowing, isOwn, myId, post.author.id]);

  const handleJoinClub = async () => {
    if (!clubInviteData?.clubId || joiningClub) return;
    setJoiningClub(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/clubs/${clubInviteData.clubId}/join`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        Toast.show({ type: 'error', text1: data?.error ?? 'Nie udało się dołączyć' });
        return;
      }
      await syncProfileClubFromServer();
      Toast.show({ type: 'success', text1: `Dołączono do klubu ${clubInviteData.clubName}` });
    } catch {
      Toast.show({ type: 'error', text1: 'Błąd połączenia' });
    } finally {
      setJoiningClub(false);
    }
  };

  const handleModerationPress = () => {
    Alert.alert(
      `@${post.author.username}`,
      'Zgłoszenie rozpatrzymy w ciągu 24 h. Blokada usuwa treści użytkownika z Twojego feedu.',
      [
        { text: 'Anuluj', style: 'cancel' },
        { text: 'Zgłoś treść', onPress: () => {
          Alert.alert('Zgłoś treść', 'Wybierz kategorię.', [
            { text: 'Anuluj', style: 'cancel' },
            { text: 'Spam / wulgarność', onPress: () => onReport(post, 'spam_vulgar') },
            { text: 'Nękanie', onPress: () => onReport(post, 'harassment') },
            { text: 'Nielegalne', onPress: () => onReport(post, 'illegal') },
            { text: 'Inne', onPress: () => onReport(post, 'other') },
          ]);
        }},
        { text: 'Zablokuj użytkownika', style: 'destructive', onPress: () => onBlock(post) },
      ],
    );
  };

  return (
    <>
      <View style={{
        marginHorizontal: 12, marginBottom: 12,
        backgroundColor: theme.surface,
        borderRadius: 20,
        borderWidth: 1, borderColor: theme.border2,
        overflow: 'hidden',
      }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 14, paddingBottom: 10 }}>
          <TouchableOpacity onPress={() => onProfile(post.author.id)}>
            <Avatar user={post.author} size={42} />
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 10 }}>
            <TouchableOpacity onPress={() => onProfile(post.author.id)}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontFamily: 'Orbitron', color: post.author.nickColor || theme.text, fontSize: 12, fontWeight: '700' }} numberOfLines={1}>
                  {post.author.username}
                </Text>
                <UserBadges isAdmin={post.author.isAdmin} isPremium={post.author.isPremium} compact />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: '#e3383515', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 }}>
                  <MaterialIcons name="bolt" size={10} color="#e33835" />
                  <Text style={{ fontFamily: 'Orbitron', color: '#e33835', fontSize: 9 }}>{post.author.points}</Text>
                </View>
              </View>
            </TouchableOpacity>
            <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 8, marginTop: 2, letterSpacing: 1 }}>{time}</Text>
            <View style={{ flexDirection: 'row', marginTop: 5 }}>
              <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: '#e3383535',
                backgroundColor: '#e3383518',
                paddingHorizontal: 7,
                paddingVertical: 2,
              }}>
                <MaterialIcons name={categoryMeta.icon as any} size={10} color="#e33835" />
                <Text style={{ color: '#e33835', fontSize: 9, fontFamily: 'Orbitron' }}>{categoryMeta.label}</Text>
              </View>
            </View>
          </View>
          {!isOwn && myId != null && (
            <TouchableOpacity
              onPress={handleFollowToggle}
              disabled={followLoading}
              style={{
                paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, marginRight: 6,
                backgroundColor: isFollowing ? theme.surface2 : '#e33835',
                borderWidth: 1,
                borderColor: isFollowing ? theme.border : '#e33835',
              }}
            >
              {followLoading
                ? <ActivityIndicator size="small" color={isFollowing ? theme.textDim : '#fff'} />
                : (
                  <Text style={{
                    fontFamily: 'Orbitron', fontSize: 8, fontWeight: '700',
                    color: isFollowing ? theme.textDim : '#fff',
                  }}>
                    {isFollowing ? 'OBSERWUJESZ' : 'OBSERWUJ'}
                  </Text>
                )
              }
            </TouchableOpacity>
          )}
          {isOwn ? (
            <TouchableOpacity
              onPress={() => setShowDelete(true)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.surface2, justifyContent: 'center', alignItems: 'center' }}
            >
              <MaterialIcons name="more-horiz" size={18} color={theme.textDim} />
            </TouchableOpacity>
          ) : myId != null ? (
            <TouchableOpacity
              onPress={handleModerationPress}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.surface2, justifyContent: 'center', alignItems: 'center' }}
            >
              <MaterialIcons name="flag" size={16} color={theme.textDim} />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Treść */}
        <TouchableOpacity
          activeOpacity={0.95}
          onPress={() => onComment(post)}
          onLongPress={() => onOpenReactionPicker(post)}
          delayLongPress={400}
        >
          {!!caption?.length && (
            <Text style={{ color: theme.textMuted, fontSize: 14, lineHeight: 22, paddingHorizontal: 14, paddingBottom: 8 }}>
              {renderDiscussionBody(caption, theme, {
                onMentionPress: async (username) => {
                  const uid = await resolveMentionUserId(username);
                  if (uid) onProfile(uid);
                },
                onHashtagPress,
              })}
            </Text>
          )}
          {!!plainText?.length && !routeData && (
            <Text style={{ color: theme.textMuted, fontSize: 14, lineHeight: 22, paddingHorizontal: 14, paddingBottom: 12 }}>
              {renderDiscussionBody(plainText, theme, {
                onMentionPress: async (username) => {
                  const uid = await resolveMentionUserId(username);
                  if (uid) onProfile(uid);
                },
                onHashtagPress,
              })}
            </Text>
          )}
          {!!routeData && (
            <RoutePreviewCard data={routeData} onNavigate={onNavigateRoute} fullWidth />
          )}
          {!!clubInviteData && (
            <View
              style={{
                marginHorizontal: 14,
                marginBottom: 12,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: '#e3383550',
                backgroundColor: '#e3383514',
                padding: 12,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <MaterialCommunityIcons name="shield-crown" size={16} color="#e33835" />
                <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 11, fontWeight: '700', flex: 1 }} numberOfLines={1}>
                  {clubInviteData.clubName}
                </Text>
              </View>
              <Text style={{ color: theme.textDim, fontSize: 11, marginBottom: 10 }}>
                {clubInviteData.memberCount ? `Członków: ${clubInviteData.memberCount}` : 'Zaproszenie do klubu'}
              </Text>
              <TouchableOpacity
                style={{ borderRadius: 10, backgroundColor: '#e33835', alignItems: 'center', justifyContent: 'center', paddingVertical: 9 }}
                onPress={handleJoinClub}
                disabled={joiningClub}
              >
                <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 10 }}>
                  {joiningClub ? 'DOŁĄCZANIE...' : 'DOŁĄCZ DO KLUBU'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
          <View style={{ paddingHorizontal: 14, paddingBottom: 12 }}>
            {!!linkUrl && <LinkPreviewCard url={linkUrl} isMe={isOwn} theme={theme} />}
            <Text style={{ fontSize: 9, alignSelf: 'flex-end', color: theme.textDim }}>
              {new Date(post.createdAt).toLocaleTimeString('pl', { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
          {(post.photos?.length > 0 || post.videos?.length > 0) && (
            <View style={{ paddingHorizontal: post.photos.length === 1 ? 0 : 14 }}>
              <MediaGrid photos={post.photos ?? []} videos={post.videos ?? []} />
            </View>
          )}
        </TouchableOpacity>
        {hasPoll && post.poll && (
          <DiscussionPollCard postId={post.id} poll={post.poll} onVote={onPollVote} />
        )}

        {!!post.reactions?.length && (
          <View style={{ paddingHorizontal: 14, paddingBottom: 8 }}>
            <ReactionChips reactions={post.reactions} onToggle={(emoji) => onReact(post.id, emoji)} />
          </View>
        )}

        {/* Repost badge */}
        {post.isReposted && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginHorizontal: 14, marginBottom: 8 }}>
            <MaterialCommunityIcons name="repeat" size={11} color="#4de926" />
            <Text style={{ fontFamily: 'Orbitron', color: '#4de926', fontSize: 8, letterSpacing: 1 }}>ZREPOSTOWANE PRZEZ CIEBIE</Text>
          </View>
        )}

        {/* Akcje */}
        <View style={{
          flexDirection: 'row', alignItems: 'center',
          paddingHorizontal: 14, paddingBottom: 12, paddingTop: 6,
          gap: 4,
          borderTopWidth: 1, borderTopColor: theme.border,
        }}>
          <ActionBtn icon="comment-outline" count={post.commentsCount} active={false} onPress={() => onComment(post)} />
          <ActionBtn icon="repeat" count={post.repostsCount} active={post.isReposted} activeColor="#4de926" onPress={() => onRepost(post.id)} />
          <ActionBtn icon={post.isLiked ? 'heart' : 'heart-outline'} count={post.likesCount} active={post.isLiked} activeColor="#e33835" onPress={() => onLike(post.id)} />
          <TouchableOpacity
            onPress={() => onOpenReactionPicker(post)}
            style={{ width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ fontSize: 16 }}>😀</Text>
          </TouchableOpacity>
        </View>
      </View>
      <DeleteModal visible={showDelete} onCancel={() => setShowDelete(false)} onConfirm={() => { setShowDelete(false); onDelete(post.id); }} />
    </>
  );
});
PostCard.displayName = 'PostCard';

// Reklama co N postów
const AD_INSERTION_INTERVAL = 2;

export const DISCUSSIONS_SCROLL_STATE = { offset: 0 };
const discussionsListRef: { current: FlatList<any> | null } = { current: null };

export function restoreDiscussionsScroll() {
  requestAnimationFrame(() => {
    discussionsListRef.current?.scrollToOffset({
      offset: DISCUSSIONS_SCROLL_STATE.offset,
      animated: false,
    });
  });
}

// ─────────────────────────────────────────────────────────
// TAB DYSKUSJE
// ─────────────────────────────────────────────────────────
export function TabDyskusje({ posts, myId, loadingMoreP, refreshingP, hasMoreP,
  onLike, onRepost, onComment, onDelete, onProfile, onRefresh, onLoadMore, onPost, onReport, onBlock, onPollVote, onReact, onOpenReactionPicker, onNavigateRoute, onHashtagPress, selectedCategory, onSelectCategory, bottomInset, isPremium, isAdmin, onUpgradePremium }: {
  posts: Post[];
  myId: number | null;
  loadingMoreP: boolean;
  refreshingP: boolean;
  hasMoreP: boolean;
  onLike: (id: number) => void;
  onRepost: (id: number) => void;
  onComment: (post: Post) => void;
  onDelete: (id: number) => void;
  onProfile: (id: number) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onPost: (text: string, photos: string[], video: string | null, category: DiscussionCategoryId, poll?: PostPollInput | null) => Promise<void>;
  onReport: (post: Post, reason: string) => void;
  onBlock: (post: Post) => void;
  onPollVote: (postId: number, optionIdx: number) => Promise<PostPollData | null>;
  onReact: (postId: number, emoji: string) => void;
  onOpenReactionPicker: (post: Post) => void;
  onNavigateRoute?: (data: RoutePreviewData) => void;
  onHashtagPress?: (tag: string) => void;
  selectedCategory: DiscussionCategoryFilter;
  onSelectCategory: (category: DiscussionCategoryFilter) => void;
  bottomInset: number;
  isPremium: boolean;
  isAdmin?: boolean;
  onUpgradePremium: () => void;
}) {
  const { theme } = useTheme();
  const [composeHeight, setComposeHeight] = useState(120);
  const restoredRef = React.useRef(false);
  type FeedItem = Post | { _adType: 'native'; _adKey: string };
  const feedItems: FeedItem[] = useMemo(() =>
    posts.flatMap((post, index) =>
      (index + 1) % AD_INSERTION_INTERVAL === 0
        ? [post, { _adType: 'native' as const, _adKey: `ad_${index}` }]
        : [post]
    ),
  [posts]);

  useEffect(() => {
    if (restoredRef.current) return;
    if (!posts.length) return;
    if (DISCUSSIONS_SCROLL_STATE.offset <= 0) {
      restoredRef.current = true;
      return;
    }
    requestAnimationFrame(() => {
      discussionsListRef.current?.scrollToOffset({
        offset: DISCUSSIONS_SCROLL_STATE.offset,
        animated: false,
      });
      restoredRef.current = true;
    });
  }, [posts.length]);

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        ref={(r) => { discussionsListRef.current = r; }}
        style={{ flex: 1 }}
        keyboardDismissMode="interactive"
        data={feedItems}
        initialNumToRender={6}
        maxToRenderPerBatch={4}
        windowSize={7}
        removeClippedSubviews
        keyExtractor={item => ('_adType' in item) ? item._adKey : String(item.id)}
        onScroll={(e) => {
          DISCUSSIONS_SCROLL_STATE.offset = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        renderItem={({ item }) => '_adType' in item ? (
          <AdPostBoundary>
            <AdNativePost />
          </AdPostBoundary>
        ) : (
          <PostCard post={item} myId={myId} onLike={onLike} onRepost={onRepost}
            onComment={onComment} onDelete={onDelete} onProfile={onProfile} onReport={onReport} onBlock={onBlock} onPollVote={onPollVote}
            onReact={onReact} onOpenReactionPicker={onOpenReactionPicker} onNavigateRoute={onNavigateRoute} onHashtagPress={onHashtagPress} />
        )}
        refreshControl={<RefreshControl refreshing={refreshingP} onRefresh={onRefresh} tintColor="#e33835" />}
        onEndReached={onLoadMore}
        onEndReachedThreshold={0.4}
        ListHeaderComponent={(
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 12, gap: 6, paddingBottom: 8 }}
          >
            {[{ id: DISCUSSION_ALL_CATEGORIES, label: 'Wszystkie', icon: 'view-list' as const }, ...DISCUSSION_CATEGORIES].map((cat) => {
              const active = selectedCategory === cat.id;
              return (
                <TouchableOpacity
                  key={cat.id}
                  onPress={() => onSelectCategory(cat.id)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 5,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: active ? '#e33835' : theme.border,
                    backgroundColor: active ? '#e3383520' : theme.surface,
                    paddingHorizontal: 10,
                    paddingVertical: 7,
                  }}
                >
                  <MaterialIcons name={cat.icon as any} size={13} color={active ? '#e33835' : theme.textDim} />
                  <Text style={{ color: active ? '#e33835' : theme.textDim, fontSize: 10, fontFamily: 'Orbitron' }}>
                    {cat.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
        ListFooterComponent={<ListFooter loading={loadingMoreP} />}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: composeHeight + Math.max(bottomInset, 12) }}
        keyboardShouldPersistTaps="handled"
      />
      <ComposeBox
        onPost={onPost}
        defaultCategory={selectedCategory === DISCUSSION_ALL_CATEGORIES ? undefined : selectedCategory}
        bottomInset={bottomInset}
        mentionsEnabled
        onHeightChange={setComposeHeight}
        isPremium={isPremium}
        isAdmin={!!isAdmin}
        onUpgradePremium={onUpgradePremium}
      />
    </View>
  );
}
