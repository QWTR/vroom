import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, Image, ActivityIndicator, RefreshControl,
  KeyboardAvoidingView, Platform, Alert, ActionSheetIOS,
  Modal, Pressable,
} from 'react-native';
import { SafeAreaView }       from 'react-native-safe-area-context';
import { useRouter }          from 'expo-router';
import { useFocusEffect }     from 'expo-router';
import MaterialIcons          from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as ImagePicker       from 'expo-image-picker';
import { Video, ResizeMode }  from 'expo-av';
import AsyncStorage           from '@react-native-async-storage/async-storage';
import Toast                  from 'react-native-toast-message';
import { API_URL }            from '../../../constants/config';
import { formatDistanceToNow } from 'date-fns';
import { pl }                 from 'date-fns/locale';

interface Author {
  id: number; username: string; avatarUrl: string | null; points: number;
}
interface Comment {
  id: number; content: string; photos: string[]; createdAt: string;
  author: Author; replyTo?: { id: number; username: string } | null;
}
interface Post {
  id: number; content: string; photos: string[]; videos: string[];
  createdAt: string; author: Author;
  likesCount: number; commentsCount: number; repostsCount: number;
  isLiked: boolean; isReposted: boolean;
}

const getToken = () => AsyncStorage.getItem('token');

// ── Avatar ────────────────────────────────────────────────
const Avatar = ({ user, size = 40 }: { user: Author; size?: number }) => (
  <View style={{
    width: size, height: size, borderRadius: size / 2,
    overflow: 'hidden', backgroundColor: '#1e1e1e',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1.5, borderColor: '#ffffff10',
  }}>
    {user.avatarUrl
      ? <Image source={{ uri: user.avatarUrl }} style={{ width: size, height: size }} resizeMode="cover" />
      : <Text style={{ color: '#e33835', fontFamily: 'Orbitron', fontSize: size * 0.32, fontWeight: '700' }}>
          {user.username.slice(0, 2).toUpperCase()}
        </Text>
    }
  </View>
);

// ── Media Grid ────────────────────────────────────────────
const MediaGrid = ({ photos, videos }: { photos: string[]; videos: string[] }) => {
  const all = [...photos];
  if (!all.length && !videos.length) return null;
  return (
    <View style={s.mediaGrid}>
      {videos.map((uri, i) => (
        <Video
          key={`v${i}`}
          source={{ uri }}
          style={[s.mediaItem, { width: '100%', height: 200 }]}
          resizeMode={ResizeMode.COVER}
          useNativeControls
          isLooping={false}
        />
      ))}
      {all.map((uri, i) => (
        <Image
          key={`p${i}`}
          source={{ uri }}
          style={[
            s.mediaItem,
            all.length === 1 && { width: '100%', height: 220 },
            all.length === 2 && { width: '49%', height: 160 },
            all.length >= 3  && { width: '32%', height: 110 },
          ]}
          resizeMode="cover"
        />
      ))}
    </View>
  );
};

// ── Delete Confirm Modal ──────────────────────────────────
const DeleteModal = ({ visible, onConfirm, onCancel }: {
  visible: boolean; onConfirm: () => void; onCancel: () => void;
}) => (
  <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
    <View style={s.deleteOverlay}>
      <View style={s.deleteCard}>
        <View style={s.deleteIconWrap}>
          <MaterialIcons name="delete-forever" size={32} color="#e33835" />
        </View>
        <Text style={s.deleteTitle}>USUŃ POST</Text>
        <Text style={s.deleteDesc}>
          Czy na pewno chcesz usunąć ten post?{'\n'}
          <Text style={{ color: '#e33835' }}>Ta operacja jest nieodwracalna.</Text>
        </Text>
        <View style={s.deleteBtns}>
          <TouchableOpacity style={s.deleteCancelBtn} onPress={onCancel}>
            <Text style={s.deleteCancelText}>Anuluj</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.deleteConfirmBtn} onPress={onConfirm}>
            <MaterialIcons name="delete" size={15} color="#fff" />
            <Text style={s.deleteConfirmText}>USUŃ</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  </Modal>
);

// ── PostCard ──────────────────────────────────────────────
const PostCard = React.memo(({ post, myId, onLike, onRepost, onComment, onDelete, onProfile }: {
  post: Post; myId: number | null;
  onLike: (id: number) => void; onRepost: (id: number) => void;
  onComment: (post: Post) => void; onDelete: (id: number) => void;
  onProfile: (id: number) => void;
}) => {
  const [showDelete, setShowDelete] = useState(false);
  const isOwn = post.author.id === myId;
  const time  = formatDistanceToNow(new Date(post.createdAt), { addSuffix: true, locale: pl });

  return (
    <>
      <TouchableOpacity style={s.postCard} activeOpacity={0.97} onPress={() => onComment(post)}>
        {/* Linia wątku */}
        <View style={s.postLeft}>
          <TouchableOpacity onPress={() => onProfile(post.author.id)}>
            <Avatar user={post.author} size={42} />
          </TouchableOpacity>
          <View style={s.threadLine} />
        </View>

        <View style={{ flex: 1, paddingBottom: 12 }}>
          {/* Header */}
          <View style={s.postHeader}>
            <TouchableOpacity onPress={() => onProfile(post.author.id)} style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={s.postAuthor} numberOfLines={1}>{post.author.username}</Text>
                <View style={s.pointsBadge}>
                  <MaterialIcons name="bolt" size={10} color="#e33835" />
                  <Text style={s.postPoints}>{post.author.points}</Text>
                </View>
              </View>
            </TouchableOpacity>
            <Text style={s.postTime}>{time}</Text>
            {isOwn && (
              <TouchableOpacity
                onPress={() => setShowDelete(true)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={{ paddingLeft: 8 }}
              >
                <MaterialIcons name="more-horiz" size={18} color="#ffffff25" />
              </TouchableOpacity>
            )}
          </View>

          {/* Content */}
          {post.content.length > 0 && (
            <Text style={s.postContent}>{post.content}</Text>
          )}

          {/* Media */}
          <MediaGrid photos={post.photos ?? []} videos={post.videos ?? []} />

          {/* Repost badge */}
          {post.isReposted && (
            <View style={s.repostBadge}>
              <MaterialCommunityIcons name="repeat" size={11} color="#4de926" />
              <Text style={s.repostBadgeText}>Zrepostowane przez Ciebie</Text>
            </View>
          )}

          {/* Actions */}
          <View style={s.postActions}>
            <TouchableOpacity style={s.actionBtn} onPress={() => onComment(post)}>
              <MaterialCommunityIcons name="comment-outline" size={17} color="#ffffff30" />
              <Text style={s.actionCount}>{post.commentsCount}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.actionBtn} onPress={() => onRepost(post.id)}>
              <MaterialCommunityIcons
                name="repeat" size={17}
                color={post.isReposted ? '#4de926' : '#ffffff30'}
              />
              <Text style={[s.actionCount, post.isReposted && { color: '#4de926' }]}>
                {post.repostsCount}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.actionBtn} onPress={() => onLike(post.id)}>
              <MaterialCommunityIcons
                name={post.isLiked ? 'heart' : 'heart-outline'} size={17}
                color={post.isLiked ? '#e33835' : '#ffffff30'}
              />
              <Text style={[s.actionCount, post.isLiked && { color: '#e33835' }]}>
                {post.likesCount}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>

      <DeleteModal
        visible={showDelete}
        onCancel={() => setShowDelete(false)}
        onConfirm={() => { setShowDelete(false); onDelete(post.id); }}
      />
    </>
  );
});

// ── Compose ───────────────────────────────────────────────
const ComposeBox = ({ onPost }: {
  onPost: (text: string, photos: string[], video: string | null) => Promise<void>;
}) => {
  const [text,    setText]    = useState('');
  const [photos,  setPhotos]  = useState<string[]>([]);
  const [video,   setVideo]   = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  const pickPhoto = async () => {
    if (photos.length >= 4 || video) return;
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85 });
    if (!r.canceled && r.assets[0]) setPhotos(prev => [...prev, r.assets[0].uri]);
  };

  const pickVideo = async () => {
    if (photos.length > 0 || video) return;
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      videoMaxDuration: 60,
    });
    if (!r.canceled && r.assets[0]) {
      const size = (r.assets[0] as any).fileSize ?? 0;
      if (size > 20 * 1024 * 1024) {
        Toast.show({ type: 'error', text1: 'Film za duży', text2: 'Maksymalnie 20MB' });
        return;
      }
      setVideo(r.assets[0].uri);
    }
  };

  const canSend = text.trim().length > 0 || photos.length > 0 || !!video;

  const handleSend = async () => {
    if (!canSend) return;
    setPosting(true);
    await onPost(text.trim(), photos, video);
    setText(''); setPhotos([]); setVideo(null);
    setPosting(false);
  };

  return (
    <View style={s.compose}>
      {/* Podgląd mediów */}
      {(photos.length > 0 || video) && (
        <View style={s.composePreviews}>
          {video && (
            <View style={{ position: 'relative' }}>
              <Video
                source={{ uri: video }}
                style={s.composeThumb}
                resizeMode={ResizeMode.COVER}
                shouldPlay={false}
              />
              <View style={s.composeVideoTag}>
                <MaterialIcons name="videocam" size={10} color="#fff" />
              </View>
              <TouchableOpacity style={s.composeRemove} onPress={() => setVideo(null)}>
                <MaterialIcons name="close" size={11} color="#fff" />
              </TouchableOpacity>
            </View>
          )}
          {photos.map((uri, i) => (
            <View key={i} style={{ position: 'relative' }}>
              <Image source={{ uri }} style={s.composeThumb} />
              <TouchableOpacity
                style={s.composeRemove}
                onPress={() => setPhotos(prev => prev.filter((_, idx) => idx !== i))}
              >
                <MaterialIcons name="close" size={11} color="#fff" />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      <View style={s.composeRow}>
        {/* Foto */}
        <TouchableOpacity
          onPress={pickPhoto}
          disabled={photos.length >= 4 || !!video}
          style={s.composeMediaBtn}
        >
          <MaterialIcons
            name="add-photo-alternate" size={22}
            color={photos.length >= 4 || !!video ? '#ffffff12' : '#e33835'}
          />
        </TouchableOpacity>

        {/* Video */}
        <TouchableOpacity
          onPress={pickVideo}
          disabled={photos.length > 0 || !!video}
          style={s.composeMediaBtn}
        >
          <MaterialIcons
            name="videocam" size={22}
            color={photos.length > 0 || !!video ? '#ffffff12' : '#ffffff50'}
          />
        </TouchableOpacity>

        <TextInput
          style={s.composeInput}
          value={text}
          onChangeText={setText}
          placeholder="Co słychać w garażu?"
          placeholderTextColor="#ffffff20"
          multiline
          maxLength={500}
        />

        <TouchableOpacity
          style={[s.composeBtn, !canSend && { opacity: 0.3 }]}
          onPress={handleSend}
          disabled={posting || !canSend}
        >
          {posting
            ? <ActivityIndicator size={14} color="#fff" />
            : <MaterialIcons name="send" size={17} color="#fff" />
          }
        </TouchableOpacity>
      </View>
    </View>
  );
};

// ─────────────────────────────────────────────────────────
// GŁÓWNY EKRAN
// ─────────────────────────────────────────────────────────
export default function CommunityScreen() {
  const router = useRouter();
  const [posts,        setPosts]        = useState<Post[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [nextCursor,   setNextCursor]   = useState<number | null>(null);
  const [loadingMore,  setLoadingMore]  = useState(false);
  const [myId,         setMyId]         = useState<number | null>(null);
  const [search,       setSearch]       = useState('');
  const [searchActive, setSearchActive] = useState(false);

  // Comments
  const [commentPost,      setCommentPost]      = useState<Post | null>(null);
  const [comments,         setComments]         = useState<Comment[]>([]);
  const [loadingComments,  setLoadingComments]  = useState(false);
  const [commentText,      setCommentText]      = useState('');
  const [commentPhotos,    setCommentPhotos]    = useState<string[]>([]);
  const [postingComment,   setPostingComment]   = useState(false);
  const [replyTo,          setReplyTo]          = useState<{ id: number; username: string } | null>(null);

  useEffect(() => {
    AsyncStorage.getItem('user').then(raw => {
      if (raw) { const u = JSON.parse(raw); setMyId(u.userId ?? u.id); }
    });
  }, []);

  const fetchPosts = async (cursor?: number) => {
    try {
      const token = await getToken();
      const url   = cursor ? `${API_URL}/api/posts?cursor=${cursor}` : `${API_URL}/api/posts`;
      const res   = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data  = await res.json();
      if (cursor) setPosts(prev => [...prev, ...(data.posts ?? [])]);
      else        setPosts(data.posts ?? []);
      setNextCursor(data.nextCursor ?? null);
    } catch (e) {
      Toast.show({ type: 'error', text1: 'Błąd ładowania postów' });
    } finally {
      setLoading(false); setRefreshing(false); setLoadingMore(false);
    }
  };

  useFocusEffect(useCallback(() => {
    setLoading(true);
    fetchPosts();
  }, []));

  const onRefresh   = () => { setRefreshing(true); fetchPosts(); };
  const onLoadMore  = () => { if (!nextCursor || loadingMore) return; setLoadingMore(true); fetchPosts(nextCursor); };

  const handlePost = async (text: string, photos: string[], video: string | null) => {
    try {
      const token = await getToken();
      const form  = new FormData();
      form.append('content', text);
      photos.forEach((uri, i) => {
        const ext = uri.split('.').pop() ?? 'jpg';
        form.append('photos', { uri, name: `p${i}.${ext}`, type: `image/${ext}` } as any);
      });
      if (video) {
        const ext = video.split('.').pop() ?? 'mp4';
        form.append('video', { uri: video, name: `video.${ext}`, type: `video/${ext}` } as any);
      }
      const res  = await fetch(`${API_URL}/api/posts`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
      });
      if (!res.ok) throw new Error();
      const post = await res.json();
      setPosts(prev => [post, ...prev]);
    } catch {
      Toast.show({ type: 'error', text1: 'Błąd wysyłania' });
    }
  };

  const handleLike = useCallback(async (postId: number) => {
    setPosts(prev => prev.map(p => p.id !== postId ? p : {
      ...p, isLiked: !p.isLiked, likesCount: p.isLiked ? p.likesCount - 1 : p.likesCount + 1,
    }));
    try {
      const token = await getToken();
      await fetch(`${API_URL}/api/posts/${postId}/like`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    } catch {}
  }, []);

  const handleRepost = useCallback(async (postId: number) => {
    setPosts(prev => prev.map(p => p.id !== postId ? p : {
      ...p, isReposted: !p.isReposted, repostsCount: p.isReposted ? p.repostsCount - 1 : p.repostsCount + 1,
    }));
    try {
      const token = await getToken();
      await fetch(`${API_URL}/api/posts/${postId}/repost`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    } catch {}
  }, []);

  const handleDelete = useCallback(async (postId: number) => {
    setPosts(prev => prev.filter(p => p.id !== postId));
    try {
      const token = await getToken();
      await fetch(`${API_URL}/api/posts/${postId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    } catch {}
  }, []);

  const openComments = useCallback(async (post: Post) => {
    setCommentPost(post); setComments([]); setLoadingComments(true);
    try {
      const token = await getToken();
      const res   = await fetch(`${API_URL}/api/posts/${post.id}/comments`, { headers: { Authorization: `Bearer ${token}` } });
      setComments(await res.json());
    } catch {}
    finally { setLoadingComments(false); }
  }, []);

  const handleSendComment = async () => {
    if (!commentText.trim() && commentPhotos.length === 0) return;
    if (!commentPost) return;
    setPostingComment(true);
    try {
      const token = await getToken();
      const form  = new FormData();
      form.append('content', commentText.trim());
      if (replyTo) form.append('replyToId', String(replyTo.id));
      commentPhotos.forEach((uri, i) => {
        const ext = uri.split('.').pop() ?? 'jpg';
        form.append('photos', { uri, name: `cp${i}.${ext}`, type: `image/${ext}` } as any);
      });
      const res     = await fetch(`${API_URL}/api/posts/${commentPost.id}/comments`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
      });
      const comment = await res.json();
      setComments(prev => [...prev, comment]);
      setCommentText(''); setCommentPhotos([]); setReplyTo(null);
      setPosts(prev => prev.map(p => p.id === commentPost.id ? { ...p, commentsCount: p.commentsCount + 1 } : p));
    } catch {}
    finally { setPostingComment(false); }
  };

  const pickCommentPhoto = async () => {
    if (commentPhotos.length >= 2) return;
    const r = await ImagePicker.launchImageLibraryAsync({ quality: 0.8 });
    if (!r.canceled && r.assets[0]) setCommentPhotos(prev => [...prev, r.assets[0].uri]);
  };

  const filteredPosts = search.trim()
    ? posts.filter(p =>
        p.content.toLowerCase().includes(search.toLowerCase()) ||
        p.author.username.toLowerCase().includes(search.toLowerCase())
      )
    : posts;

  if (loading) {
    return (
      <View style={[s.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color="#e33835" size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={['top']}>

      {/* HEADER */}
      <View style={s.header}>
        {searchActive ? (
          <View style={s.searchBar}>
            <MaterialIcons name="search" size={17} color="#ffffff35" />
            <TextInput
              style={s.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Szukaj postów, użytkowników..."
              placeholderTextColor="#ffffff25"
              autoFocus
            />
            <TouchableOpacity onPress={() => { setSearch(''); setSearchActive(false); }}>
              <MaterialIcons name="close" size={17} color="#ffffff35" />
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <TouchableOpacity onPress={() => router.back()} style={{ padding: 4 }}>
              <MaterialIcons name="arrow-back" size={22} color="#fff" />
            </TouchableOpacity>
            <Text style={s.headerTitle}>DYSKUSJE</Text>
            <TouchableOpacity onPress={() => setSearchActive(true)} style={{ padding: 4 }}>
              <MaterialIcons name="search" size={22} color="#ffffff50" />
            </TouchableOpacity>
          </>
        )}
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <FlatList
          data={filteredPosts}
          keyExtractor={p => String(p.id)}
          renderItem={({ item }) => (
            <PostCard
              post={item} myId={myId}
              onLike={handleLike} onRepost={handleRepost}
              onComment={openComments} onDelete={handleDelete}
              onProfile={id => router.push({ pathname: '/profile/[userId]', params: { userId: String(id) } })}
            />
          )}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#e33835" />}
          onEndReached={onLoadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={loadingMore ? <ActivityIndicator color="#e33835" style={{ padding: 20 }} /> : null}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', marginTop: 80, gap: 12 }}>
              <MaterialCommunityIcons name="car-off" size={52} color="#ffffff08" />
              <Text style={{ fontFamily: 'Orbitron', color: '#ffffff12', fontSize: 11, letterSpacing: 2 }}>
                {search ? 'BRAK WYNIKÓW' : 'BRAK POSTÓW'}
              </Text>
            </View>
          }
          ItemSeparatorComponent={() => <View style={s.separator} />}
          contentContainerStyle={{ paddingBottom: 8 }}
          keyboardShouldPersistTaps="handled"
        />

        <ComposeBox onPost={handlePost} />
      </KeyboardAvoidingView>

      {/* ── MODAL KOMENTARZY ───────────────────────────────── */}
      <Modal
        visible={!!commentPost}
        animationType="slide"
        transparent
        onRequestClose={() => setCommentPost(null)}
      >
        <View style={s.commentOverlay}>
          <Pressable style={s.commentBackdrop} onPress={() => setCommentPost(null)} />

          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={s.commentSheet}
          >
            <View style={s.commentHandle} />

            {/* Header */}
            <View style={s.commentSheetHeader}>
              <Text style={s.commentSheetTitle}>KOMENTARZE</Text>
              <TouchableOpacity onPress={() => setCommentPost(null)}>
                <MaterialIcons name="close" size={20} color="#ffffff40" />
              </TouchableOpacity>
            </View>

            {/* Oryginalny post */}
            {commentPost && (
              <View style={s.originalPost}>
                <Avatar user={commentPost.author} size={30} />
                <View style={{ flex: 1 }}>
                  <Text style={s.originalAuthor}>{commentPost.author.username}</Text>
                  {commentPost.content.length > 0 && (
                    <Text style={s.originalText} numberOfLines={2}>{commentPost.content}</Text>
                  )}
                </View>
              </View>
            )}

            <View style={s.commentDivider} />

            {/* Lista */}
            {loadingComments ? (
              <ActivityIndicator color="#e33835" style={{ margin: 30 }} />
            ) : (
              <FlatList
                data={comments}
                keyExtractor={c => String(c.id)}
                style={{ maxHeight: 320 }}
                renderItem={({ item }) => (
                  <View style={s.commentItem}>
                    <Avatar user={item.author} size={32} />
                    <View style={{ flex: 1 }}>
                      <View style={s.commentItemHeader}>
                        <Text style={s.commentAuthor}>{item.author.username}</Text>
                        <Text style={s.commentTime}>
                          {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true, locale: pl })}
                        </Text>
                        <TouchableOpacity
                          onPress={() => setReplyTo({ id: item.id, username: item.author.username })}
                          style={{ marginLeft: 'auto' }}
                        >
                          <Text style={s.replyBtn}>odpowiedz</Text>
                        </TouchableOpacity>
                      </View>
                      {item.replyTo && (
                        <Text style={s.replyTag}>↩ @{item.replyTo.username}</Text>
                      )}
                      <Text style={s.commentContent}>{item.content}</Text>
                      {item.photos?.length > 0 && (
                        <View style={[s.mediaGrid, { marginTop: 6 }]}>
                          {item.photos.map((uri: string, i: number) => (
                            <Image key={i} source={{ uri }} style={{ width: 80, height: 80, borderRadius: 8 }} resizeMode="cover" />
                          ))}
                        </View>
                      )}
                    </View>
                  </View>
                )}
                ListEmptyComponent={
                  <Text style={{ color: '#ffffff15', fontFamily: 'Orbitron', fontSize: 10, textAlign: 'center', marginTop: 24 }}>
                    BRAK KOMENTARZY
                  </Text>
                }
                keyboardShouldPersistTaps="handled"
              />
            )}

            {/* Reply bar */}
            {replyTo && (
              <View style={s.replyBar}>
                <Text style={s.replyBarText}>↩ @{replyTo.username}</Text>
                <TouchableOpacity onPress={() => setReplyTo(null)}>
                  <MaterialIcons name="close" size={14} color="#ffffff40" />
                </TouchableOpacity>
              </View>
            )}

            {/* Podgląd zdjęć komentarza */}
            {commentPhotos.length > 0 && (
              <View style={[s.composePreviews, { marginBottom: 8 }]}>
                {commentPhotos.map((uri, i) => (
                  <View key={i}>
                    <Image source={{ uri }} style={s.composeThumb} />
                    <TouchableOpacity
                      style={s.composeRemove}
                      onPress={() => setCommentPhotos(prev => prev.filter((_, idx) => idx !== i))}
                    >
                      <MaterialIcons name="close" size={11} color="#fff" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {/* Input */}
            <View style={s.commentInputRow}>
              <TouchableOpacity onPress={pickCommentPhoto} disabled={commentPhotos.length >= 2}>
                <MaterialIcons
                  name="add-photo-alternate" size={22}
                  color={commentPhotos.length >= 2 ? '#ffffff12' : '#e33835'}
                />
              </TouchableOpacity>
              <TextInput
                style={s.commentInput}
                value={commentText}
                onChangeText={setCommentText}
                placeholder={replyTo ? `Odpowiedz @${replyTo.username}...` : 'Napisz komentarz...'}
                placeholderTextColor="#ffffff20"
                multiline
              />
              <TouchableOpacity
                style={[s.composeBtn, (!commentText.trim() && commentPhotos.length === 0) && { opacity: 0.3 }]}
                onPress={handleSendComment}
                disabled={(!commentText.trim() && commentPhotos.length === 0) || postingComment}
              >
                {postingComment
                  ? <ActivityIndicator size={14} color="#fff" />
                  : <MaterialIcons name="send" size={16} color="#fff" />
                }
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#090909' },

  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#ffffff07' },
  headerTitle: { fontFamily: 'Orbitron', color: '#fff', fontSize: 14, letterSpacing: 2 },
  searchBar:   { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, gap: 8, borderWidth: 1, borderColor: '#ffffff0a' },
  searchInput: { flex: 1, color: '#fff', fontSize: 14 },

  separator:   { height: 1, backgroundColor: '#ffffff05', marginLeft: 70 },

  // Post — thread style
  postCard:    { flexDirection: 'row', paddingHorizontal: 14, paddingTop: 14 },
  postLeft:    { alignItems: 'center', marginRight: 12, width: 42 },
  threadLine:  { flex: 1, width: 1.5, backgroundColor: '#ffffff08', marginTop: 6, minHeight: 20 },
  postHeader:  { flexDirection: 'row', alignItems: 'center', marginBottom: 7 },
  postAuthor:  { fontFamily: 'Orbitron', color: '#fff', fontSize: 12, fontWeight: '700' },
  pointsBadge: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: '#e3383512', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 },
  postPoints:  { fontFamily: 'Orbitron', color: '#e33835', fontSize: 9 },
  postTime:    { fontFamily: 'Orbitron', color: '#ffffff20', fontSize: 9, marginLeft: 8 },
  postContent: { color: '#ffffffd0', fontSize: 14, lineHeight: 21, marginBottom: 10 },

  mediaGrid:     { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 10 },
  mediaItem:     { borderRadius: 12, backgroundColor: '#1a1a1a', overflow: 'hidden' },

  repostBadge:     { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 },
  repostBadgeText: { fontFamily: 'Orbitron', color: '#4de926', fontSize: 9 },

  postActions: { flexDirection: 'row', gap: 22, marginTop: 2 },
  actionBtn:   { flexDirection: 'row', alignItems: 'center', gap: 5 },
  actionCount: { fontFamily: 'Orbitron', color: '#ffffff25', fontSize: 11 },

  // Compose
  compose:          { borderTopWidth: 1, borderTopColor: '#ffffff08', backgroundColor: '#0c0c0c', paddingHorizontal: 14, paddingVertical: 10 },
  composeRow:       { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  composeMediaBtn:  { paddingBottom: 3 },
  composeInput:     { flex: 1, backgroundColor: '#181818', borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, color: '#fff', fontSize: 14, maxHeight: 100, borderWidth: 1, borderColor: '#ffffff08' },
  composeBtn:       { width: 38, height: 38, borderRadius: 19, backgroundColor: '#e33835', justifyContent: 'center', alignItems: 'center' },
  composePreviews:  { flexDirection: 'row', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  composeThumb:     { width: 58, height: 58, borderRadius: 10, backgroundColor: '#1a1a1a' },
  composeRemove:    { position: 'absolute', top: -5, right: -5, backgroundColor: '#e33835', borderRadius: 9, width: 17, height: 17, justifyContent: 'center', alignItems: 'center' },
  composeVideoTag:  { position: 'absolute', bottom: 4, left: 4, backgroundColor: '#000000aa', borderRadius: 5, padding: 2 },

  // Delete modal
  deleteOverlay:    { flex: 1, backgroundColor: '#000000cc', justifyContent: 'center', alignItems: 'center', padding: 24 },
  deleteCard:       { backgroundColor: '#161616', borderRadius: 20, padding: 24, width: '100%', borderWidth: 1, borderColor: '#ffffff0a', alignItems: 'center' },
  deleteIconWrap:   { width: 64, height: 64, borderRadius: 20, backgroundColor: '#e3383518', justifyContent: 'center', alignItems: 'center', marginBottom: 14 },
  deleteTitle:      { fontFamily: 'Orbitron', color: '#fff', fontSize: 15, letterSpacing: 2, marginBottom: 10 },
  deleteDesc:       { color: '#ffffff60', fontSize: 13, lineHeight: 20, textAlign: 'center', marginBottom: 22 },
  deleteBtns:       { flexDirection: 'row', gap: 10, width: '100%' },
  deleteCancelBtn:  { flex: 1, backgroundColor: '#222', borderRadius: 12, paddingVertical: 13, alignItems: 'center', borderWidth: 1, borderColor: '#ffffff0a' },
  deleteCancelText: { fontFamily: 'Orbitron', color: '#fff', fontSize: 12 },
  deleteConfirmBtn: { flex: 1, backgroundColor: '#e33835', borderRadius: 12, paddingVertical: 13, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 },
  deleteConfirmText:{ fontFamily: 'Orbitron', color: '#fff', fontSize: 12 },

  // Comment modal
  commentOverlay:      { flex: 1, justifyContent: 'flex-end', backgroundColor: '#000000bb' },
  commentBackdrop:     { flex: 1 },
  commentSheet:        { backgroundColor: '#111', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 10, paddingBottom: Platform.OS === 'ios' ? 34 : 16, maxHeight: '88%', borderWidth: 1, borderColor: '#ffffff08' },
  commentHandle:       { width: 36, height: 4, borderRadius: 2, backgroundColor: '#ffffff12', alignSelf: 'center', marginBottom: 14 },
  commentSheetHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  commentSheetTitle:   { fontFamily: 'Orbitron', color: '#fff', fontSize: 13, letterSpacing: 2 },
  commentDivider:      { height: 1, backgroundColor: '#ffffff07', marginBottom: 10 },

  originalPost:   { flexDirection: 'row', gap: 10, marginBottom: 12, backgroundColor: '#181818', borderRadius: 12, padding: 10, borderWidth: 1, borderColor: '#ffffff07' },
  originalAuthor: { fontFamily: 'Orbitron', color: '#fff', fontSize: 11, marginBottom: 3 },
  originalText:   { color: '#ffffff50', fontSize: 13, lineHeight: 18 },

  commentItem:       { flexDirection: 'row', gap: 10, marginBottom: 14 },
  commentItemHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' },
  commentAuthor:     { fontFamily: 'Orbitron', color: '#fff', fontSize: 11, fontWeight: '700' },
  commentTime:       { fontFamily: 'Orbitron', color: '#ffffff20', fontSize: 9 },
  replyBtn:          { fontFamily: 'Orbitron', color: '#e33835', fontSize: 9 },
  replyTag:          { fontFamily: 'Orbitron', color: '#e3383560', fontSize: 9, marginBottom: 4 },
  commentContent:    { color: '#ffffffbb', fontSize: 13, lineHeight: 19 },

  replyBar:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#1a1a1a', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, marginBottom: 8 },
  replyBarText: { fontFamily: 'Orbitron', color: '#e33835', fontSize: 10 },

  commentInputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#ffffff07' },
  commentInput:    { flex: 1, backgroundColor: '#181818', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, color: '#fff', fontSize: 13, maxHeight: 80, borderWidth: 1, borderColor: '#ffffff08' },
});