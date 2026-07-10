import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  RefreshControl, Alert, ActivityIndicator, ScrollView, Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage            from '@react-native-async-storage/async-storage';
import Toast                   from 'react-native-toast-message';
import { formatDistanceToNow } from 'date-fns';
import { pl }                  from 'date-fns/locale';
import { useTheme }            from '../../../contexts/ThemeContext';
import { API_URL }             from '../../../constants/config';
import { syncProfileClubFromServer } from '../../../lib/profileClubSync';
import { AdSlot }               from '../../../components/ads/AdSlot';
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
  const isSystemNews = post.postType === 'system_news' || !!post.isSystem;
  const titleText = post.title?.trim() || '';
  const newsExcerpt = (post.excerpt || '').trim();
  const feedText = isSystemNews ? (newsExcerpt || plainText) : plainText;
  const hasMoreNews = isSystemNews && !!post.content?.trim() && post.content.trim() !== feedText.trim();
  const linkUrl   = isSystemNews ? post.sourceUrl : ((!routeData && !clubInviteData && !hasPoll) ? extractUrl(post.content) : null);
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

  const cardGradient = isDark
    ? ['rgba(255, 255, 255, 0.04)', 'rgba(255, 255, 255, 0.01)'] as const
    : ['rgba(0, 0, 0, 0.02)', 'rgba(0, 0, 0, 0.00)'] as const;
  const cardBorder = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const cardShadow = Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.3,
      shadowRadius: 10,
    },
    android: { elevation: 6 },
    default: {},
  });

  return (
    <>
      <View style={{
        marginHorizontal: 16, marginBottom: 16,
        borderRadius: 20,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: cardBorder,
        ...cardShadow,
      }}>
        <LinearGradient
          colors={cardGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={{ overflow: 'hidden' }}
        >
        {/* Header — nick w osobnej linii; odznaki + akcje nie ściskają się w jednym rzędzie */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', padding: 14, paddingBottom: 10, gap: 10 }}>
          <TouchableOpacity onPress={() => onProfile(post.author.id)} style={{ flexShrink: 0 }}>
            <Avatar user={post.author} size={42} />
          </TouchableOpacity>

          <View style={{ flex: 1, minWidth: 0 }}>
            <TouchableOpacity onPress={() => onProfile(post.author.id)} activeOpacity={0.7}>
              <Text
                style={{
                  fontFamily: 'Orbitron',
                  color: post.author.nickColor || theme.text,
                  fontSize: 13,
                  fontWeight: '700',
                  letterSpacing: 0.3,
                }}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {post.author.username}
              </Text>
            </TouchableOpacity>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 5 }}>
              <UserBadges isAdmin={post.author.isAdmin} isPremium={post.author.isPremium} compact />
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 2,
                backgroundColor: isDark ? '#e3383520' : '#e3383510', borderRadius: 10,
                paddingHorizontal: 7, paddingVertical: 3, flexShrink: 0,
              }}>
                <MaterialIcons name="bolt" size={10} color={theme.primary} />
                <Text style={{ fontFamily: 'Orbitron', color: theme.primary, fontSize: 9 }}>{post.author.points}</Text>
              </View>
            </View>

            <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 8, marginTop: 6, letterSpacing: 1 }}>
              {time}
            </Text>

            <View style={{ flexDirection: 'row', marginTop: 5 }}>
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 4,
                borderRadius: 10,
                backgroundColor: isDark ? '#e3383520' : '#e3383510', paddingHorizontal: 8, paddingVertical: 3,
              }}>
                <MaterialIcons name={categoryMeta.icon as any} size={10} color={theme.primary} />
                <Text style={{ color: theme.primary, fontSize: 9, fontFamily: 'Orbitron' }}>{categoryMeta.label}</Text>
              </View>
              {isSystemNews && (
                <View style={{
                  flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 6,
                  borderRadius: 10,
                  backgroundColor: '#e33835',
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                }}>
                  <MaterialIcons name="newspaper" size={10} color="#fff" />
                  <Text style={{ color: '#fff', fontSize: 8, fontFamily: 'Orbitron', fontWeight: '700' }}>VROOM NEWS</Text>
                </View>
              )}
            </View>
          </View>

          <View style={{ flexShrink: 0, alignItems: 'flex-end', gap: 6, paddingTop: 2 }}>
            {!isOwn && myId != null && (
              <TouchableOpacity
                onPress={handleFollowToggle}
                disabled={followLoading}
                style={{
                  paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10,
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
        </View>

        {/* Treść + media + ankieta */}
        <View style={{ gap: 12 }}>
          <TouchableOpacity
            activeOpacity={0.95}
            onPress={() => onComment(post)}
            onLongPress={() => onOpenReactionPicker(post)}
            delayLongPress={400}
            style={{ gap: 8 }}
          >
            {isSystemNews && (
              <View style={{ paddingHorizontal: 16, paddingTop: 2 }}>
                <View style={{
                  alignSelf: 'flex-start',
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: '#e3383545',
                  backgroundColor: isDark ? '#e3383518' : '#e338350f',
                  paddingHorizontal: 9,
                  paddingVertical: 4,
                  marginBottom: 4,
                }}>
                  <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 8, fontWeight: '700', letterSpacing: 1 }}>
                    {post.sourceName ? `ZRODLO: ${post.sourceName}` : 'SYSTEMOWY TEMAT'}
                  </Text>
                </View>
              </View>
            )}
            {!!titleText && (
              <Text style={{
                color: theme.text,
                fontSize: isSystemNews ? 18 : 15,
                lineHeight: isSystemNews ? 23 : 20,
                fontWeight: '800',
                paddingHorizontal: 16,
              }}>
                {titleText}
              </Text>
            )}
            {!!caption?.length && (
              <Text style={{ color: theme.textMuted, fontSize: 14, lineHeight: 22, paddingHorizontal: 16, paddingBottom: 4 }}>
                {renderDiscussionBody(caption, theme, {
                  onMentionPress: async (username) => {
                    const uid = await resolveMentionUserId(username);
                    if (uid) onProfile(uid);
                  },
                  onHashtagPress,
                })}
              </Text>
            )}
            {!!feedText?.length && !routeData && (
              <Text
                style={{ color: theme.textMuted, fontSize: 14, lineHeight: 22, paddingHorizontal: 16 }}
                numberOfLines={isSystemNews ? 3 : undefined}
              >
                {renderDiscussionBody(feedText, theme, {
                  onMentionPress: async (username) => {
                    const uid = await resolveMentionUserId(username);
                    if (uid) onProfile(uid);
                  },
                  onHashtagPress,
                })}
              </Text>
            )}
            {hasMoreNews && (
              <TouchableOpacity
                onPress={() => onComment(post)}
                style={{ alignSelf: 'flex-start', marginHorizontal: 16, marginTop: -2 }}
              >
                <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 10, fontWeight: '700' }}>
                  CZYTAJ WIECEJ
                </Text>
              </TouchableOpacity>
            )}
            {!!routeData && (
              <View style={{ paddingHorizontal: 16 }}>
                <RoutePreviewCard data={routeData} onNavigate={onNavigateRoute} fullWidth />
              </View>
            )}
            {!!clubInviteData && (
              <View
                style={{
                  marginHorizontal: 16,
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
            {(!!linkUrl || !(post.photos?.length || post.videos?.length)) && (
              <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
                {!!linkUrl && <LinkPreviewCard url={linkUrl} isMe={isOwn} theme={theme} />}
                {!(post.photos?.length || post.videos?.length) && (
                  <Text style={{ fontSize: 9, alignSelf: 'flex-end', color: theme.textDim, marginTop: linkUrl ? 6 : 0 }}>
                    {new Date(post.createdAt).toLocaleTimeString('pl', { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                )}
              </View>
            )}
          </TouchableOpacity>

          {(post.photos?.length > 0 || post.videos?.length > 0) && (
            <View>
              <MediaGrid photos={post.photos ?? []} videos={post.videos ?? []} />
              <Text style={{ fontSize: 9, alignSelf: 'flex-end', color: theme.textDim, marginRight: 16, marginTop: 4 }}>
                {new Date(post.createdAt).toLocaleTimeString('pl', { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
          )}

          {hasPoll && post.poll && (
            <DiscussionPollCard postId={post.id} poll={post.poll} onVote={onPollVote} />
          )}

          {!!post.reactions?.length && (
            <View style={{ paddingHorizontal: 16, paddingBottom: 4 }}>
              <ReactionChips reactions={post.reactions} onToggle={(emoji) => onReact(post.id, emoji)} />
            </View>
          )}
        </View>

        {/* Repost badge */}
        {post.isReposted && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginHorizontal: 14, marginBottom: 8 }}>
            <MaterialCommunityIcons name="repeat" size={11} color="#4de926" />
            <Text style={{ fontFamily: 'Orbitron', color: '#4de926', fontSize: 8, letterSpacing: 1 }}>ZREPOSTOWANE PRZEZ CIEBIE</Text>
          </View>
        )}

        {/* Akcje */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap',
          paddingHorizontal: 14, paddingBottom: 14, paddingTop: 10,
          gap: 8,
        }}>
          <ActionBtn icon="comment-outline" count={post.commentsCount} active={false} onPress={() => onComment(post)} />
          <ActionBtn icon="repeat" count={post.repostsCount} active={post.isReposted} activeColor="#4de926" onPress={() => onRepost(post.id)} />
          <ActionBtn icon={post.isLiked ? 'heart' : 'heart-outline'} count={post.likesCount} active={post.isLiked} activeColor="#e33835" onPress={() => onLike(post.id)} />
          <TouchableOpacity
            onPress={() => onOpenReactionPicker(post)}
            style={{
              paddingVertical: 6, paddingHorizontal: 10, borderRadius: 14,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
            }}
          >
            <Text style={{ fontSize: 14 }}>😀</Text>
          </TouchableOpacity>
        </View>
        </LinearGradient>
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
  onPost: (text: string, photos: string[], video: string | null, category: DiscussionCategoryId, poll?: PostPollInput | null, title?: string) => Promise<void>;
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
  const { theme, isDark } = useTheme();
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
            <AdSlot placement="feed_native" variant="native" />
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
            contentContainerStyle={{ paddingHorizontal: 16, gap: 4, paddingBottom: 4 }}
          >
            {([{ id: DISCUSSION_ALL_CATEGORIES, label: 'Wszystkie' }, ...DISCUSSION_CATEGORIES] as Array<{ id: DiscussionCategoryFilter; label: string; icon?: string }>).map((cat) => {
              const active = selectedCategory === cat.id;
              return (
                <TouchableOpacity
                  key={cat.id}
                  onPress={() => onSelectCategory(cat.id)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    borderBottomWidth: 2,
                    borderBottomColor: active ? theme.primary : 'transparent',
                    marginBottom: -1,
                  }}
                >
                  <Text style={{
                    color: active ? theme.primary : theme.textDim,
                    fontSize: 10,
                    fontFamily: 'Orbitron',
                    fontWeight: active ? '700' : '500',
                    letterSpacing: 0.3,
                  }}>
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
