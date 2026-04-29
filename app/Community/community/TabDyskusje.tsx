import React, { useMemo, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  KeyboardAvoidingView, Platform, RefreshControl,
} from 'react-native';
import AsyncStorage            from '@react-native-async-storage/async-storage';
import Toast                   from 'react-native-toast-message';
import { formatDistanceToNow } from 'date-fns';
import { pl }                  from 'date-fns/locale';
import { useTheme }            from '../../../contexts/ThemeContext';
import { API_URL }             from '../../../constants/config';
import { AdBanner }            from '../../../components/ads/AdBanner';
import { BannerAdSize }        from 'react-native-google-mobile-ads';
import { LinkPreviewCard }     from '@/components/chat/LinkPreviewCard';
import MaterialIcons           from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons  from '@expo/vector-icons/MaterialCommunityIcons';
import {
  type Post,
  Avatar, MediaGrid, DeleteModal, ActionBtn, ListFooter, ComposeBox,
  extractUrl, renderDiscussionBody,
} from './communityShared';

// ─────────────────────────────────────────────────────────
// POST CARD
// ─────────────────────────────────────────────────────────
const PostCard = React.memo(({
  post, myId, onLike, onRepost, onComment, onDelete, onProfile,
}: {
  post: Post; myId: number | null;
  onLike: (id: number) => void;
  onRepost: (id: number) => void;
  onComment: (post: Post) => void;
  onDelete: (id: number) => void;
  onProfile: (id: number) => void;
}) => {
  const { theme, isDark } = useTheme();
  const [showDelete, setShowDelete] = useState(false);
  const [joiningClub, setJoiningClub] = useState(false);
  const isOwn = post.author.id === myId;
  const time  = formatDistanceToNow(new Date(post.createdAt), { addSuffix: true, locale: pl });
  const getToken = () => AsyncStorage.getItem('token');

  function parseRouteMessage(content: string) {
    try {
      const parsed = JSON.parse(content);
      if (parsed?.type === 'route') return parsed;
    } catch {}
    return null;
  }

  function parseClubInviteMessage(content: string) {
    try {
      const parsed = JSON.parse(content);
      if (parsed?.type === 'clubInvite' && parsed?.clubId && parsed?.clubName) return parsed;
    } catch {}
    return null;
  }

  const routeData = parseRouteMessage(post.content);
  const clubInviteData = parseClubInviteMessage(post.content);
  const plainText = clubInviteData?.message ? String(clubInviteData.message) : post.content;
  const linkUrl   = (!routeData && !clubInviteData) ? extractUrl(post.content) : null;

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
      Toast.show({ type: 'success', text1: `Dołączono do klubu ${clubInviteData.clubName}` });
    } catch {
      Toast.show({ type: 'error', text1: 'Błąd połączenia' });
    } finally {
      setJoiningClub(false);
    }
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
                {post.author.isPremium && (
                  <View style={{ backgroundColor: '#FFD70020', borderRadius: 8, borderWidth: 1, borderColor: '#FFD70040', paddingHorizontal: 6, paddingVertical: 2 }}>
                    <Text style={{ fontFamily: 'Orbitron', color: '#FFD700', fontSize: 8 }}>PREMIUM</Text>
                  </View>
                )}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: '#e3383515', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 }}>
                  <MaterialIcons name="bolt" size={10} color="#e33835" />
                  <Text style={{ fontFamily: 'Orbitron', color: '#e33835', fontSize: 9 }}>{post.author.points}</Text>
                </View>
              </View>
            </TouchableOpacity>
            <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 8, marginTop: 2, letterSpacing: 1 }}>{time}</Text>
          </View>
          {isOwn && (
            <TouchableOpacity
              onPress={() => setShowDelete(true)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.surface2, justifyContent: 'center', alignItems: 'center' }}
            >
              <MaterialIcons name="more-horiz" size={18} color={theme.textDim} />
            </TouchableOpacity>
          )}
        </View>

        {/* Treść */}
        <TouchableOpacity activeOpacity={0.95} onPress={() => onComment(post)}>
          {!!plainText?.length && !routeData && (
            <Text style={{ color: theme.textMuted, fontSize: 14, lineHeight: 22, paddingHorizontal: 14, paddingBottom: 12 }}>
              {renderDiscussionBody(plainText, theme)}
            </Text>
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
        </View>
      </View>
      <DeleteModal visible={showDelete} onCancel={() => setShowDelete(false)} onConfirm={() => { setShowDelete(false); onDelete(post.id); }} />
    </>
  );
});

// Reklama co N postów
const AD_INSERTION_INTERVAL = 2;

// ─────────────────────────────────────────────────────────
// TAB DYSKUSJE
// ─────────────────────────────────────────────────────────
export function TabDyskusje({ posts, myId, loadingMoreP, refreshingP, hasMoreP,
  onLike, onRepost, onComment, onDelete, onProfile, onRefresh, onLoadMore, onPost, bottomInset }: {
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
  onPost: (text: string, photos: string[], video: string | null) => Promise<void>;
  bottomInset: number;
}) {
  type FeedItem = Post | { _adType: 'native'; _adKey: string };
  const feedItems: FeedItem[] = useMemo(() =>
    posts.flatMap((post, index) =>
      (index + 1) % AD_INSERTION_INTERVAL === 0
        ? [post, { _adType: 'native' as const, _adKey: `ad_${index}` }]
        : [post]
    ),
  [posts]);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <FlatList
        data={feedItems}
        keyExtractor={item => ('_adType' in item) ? item._adKey : String(item.id)}
        renderItem={({ item }) => '_adType' in item ? (
          <AdBanner
            BANNERID="ca-app-pub-1660420496578702/3363343740"
          />
        ) : (
          <PostCard post={item} myId={myId} onLike={onLike} onRepost={onRepost}
            onComment={onComment} onDelete={onDelete} onProfile={onProfile} />
        )}
        refreshControl={<RefreshControl refreshing={refreshingP} onRefresh={onRefresh} tintColor="#e33835" />}
        onEndReached={onLoadMore}
        onEndReachedThreshold={0.4}
        ListFooterComponent={<ListFooter loading={loadingMoreP} />}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 8 }}
        keyboardShouldPersistTaps="handled"
      />
      <ComposeBox onPost={onPost} bottomInset={bottomInset} mentionsEnabled />
    </KeyboardAvoidingView>
  );
}
