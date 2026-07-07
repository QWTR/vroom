import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  Pressable,
  FlatList,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  StyleSheet,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../contexts/ThemeContext';
import { useFormKeyboardPadding } from '../../hooks/useKeyboardInset';
import { API_URL } from '../../constants/config';
import { Avatar, type Author, type VroomkiComment, type VroomkiPost } from '../../app/Community/community/communityShared';

const getToken = () => AsyncStorage.getItem('token');

export function VroomkiCommentsModal({
  post,
  myId,
  onClose,
  onCommentAdded,
}: {
  post: VroomkiPost | null;
  myId: number | null;
  onClose: () => void;
  onCommentAdded: (id: number) => void;
}) {
  const { theme } = useTheme();
  const { footerPaddingBottom } = useFormKeyboardPadding(16);
  const [comments, setComments] = useState<VroomkiComment[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [replyTo, setReplyTo] = useState<{ id: number; username: string } | null>(null);
  const [me, setMe] = useState<Author | null>(null);
  const pendingCommentLikesRef = useRef<Set<number>>(new Set());
  const inputRef = useRef<TextInput>(null);

  const isLegacyCarOnly = post != null && post.id < 0;
  const useVroomkiCommentsApi = post != null && post.id > 0;
  const commentsUrl = isLegacyCarOnly
    ? `${API_URL}/api/cars/${Math.abs(post!.id)}/comments`
    : useVroomkiCommentsApi
      ? `${API_URL}/api/vroomki/${post!.id}/comments`
      : null;

  useEffect(() => {
    AsyncStorage.getItem('user').then((raw) => {
      if (!raw) return;
      try {
        const u = JSON.parse(raw);
        setMe({
          id: u.userId ?? u.id,
          username: u.username ?? 'ty',
          avatarUrl: u.avatarUrl ?? null,
          points: u.points ?? 0,
        });
      } catch {
        // ignore
      }
    });
  }, []);

  useEffect(() => {
    setReplyTo(null);
    setText('');
  }, [post?.id]);

  useEffect(() => {
    if (!post || !commentsUrl) return;
    (async () => {
      setLoading(true);
      try {
        const token = await getToken();
        const headers = { Authorization: `Bearer ${token}` };
        const mapComment = (comment: any, legacy = false): VroomkiComment => ({
          id: comment.id,
          content: comment.content ?? comment.text ?? '',
          createdAt: comment.createdAt,
          author: comment.author ?? comment.user,
          replyTo: legacy ? null : (comment.replyTo ?? null),
          likesCount: legacy ? 0 : (comment.likesCount ?? 0),
          isLiked: legacy ? false : !!comment.isLiked,
          legacyOnly: legacy,
        });

        const res = await fetch(commentsUrl, { headers });
        const data = await res.json();
        let list: VroomkiComment[] = (Array.isArray(data) ? data : []).map((c: any) => mapComment(c));

        if (useVroomkiCommentsApi && post.legacyCarId) {
          const carRes = await fetch(`${API_URL}/api/cars/${post.legacyCarId}/comments`, { headers });
          if (carRes.ok) {
            const carData = await carRes.json();
            const legacyList = (Array.isArray(carData) ? carData : []).map((c: any) => mapComment(c, true));
            const vroomkiIds = new Set(list.map((c) => `${c.author.id}:${c.content}:${c.createdAt}`));
            const merged = [
              ...list,
              ...legacyList.filter((c) => !vroomkiIds.has(`${c.author.id}:${c.content}:${c.createdAt}`)),
            ];
            merged.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
            list = merged;
          }
        }

        setComments(list);
      } catch {
        Toast.show({ type: 'error', text1: 'Błąd ładowania komentarzy' });
      } finally {
        setLoading(false);
      }
    })();
  }, [commentsUrl, post, useVroomkiCommentsApi]);

  const likeComment = async (commentId: number) => {
    if (!useVroomkiCommentsApi) return;
    if (pendingCommentLikesRef.current.has(commentId)) return;
    const current = comments.find((c) => c.id === commentId);
    if (!current) return;
    const nextLiked = !current.isLiked;
    const nextCount = Math.max(0, (current.likesCount ?? 0) + (nextLiked ? 1 : -1));
    pendingCommentLikesRef.current.add(commentId);
    setComments((prev) => prev.map((c) => (c.id === commentId ? { ...c, isLiked: nextLiked, likesCount: nextCount } : c)));
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/vroomki/comments/${commentId}/like`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setComments((prev) => prev.map((c) => (c.id === commentId
        ? { ...c, isLiked: !!data.liked, likesCount: data.likesCount ?? nextCount }
        : c)));
    } catch {
      setComments((prev) => prev.map((c) => (c.id === commentId ? current : c)));
    } finally {
      pendingCommentLikesRef.current.delete(commentId);
    }
  };

  const send = async () => {
    if (!post || !commentsUrl || !text.trim() || posting) return;
    setPosting(true);
    try {
      const token = await getToken();
      const body = isLegacyCarOnly
        ? { text: text.trim() }
        : { content: text.trim(), ...(replyTo ? { replyToId: replyTo.id } : {}) };
      const res = await fetch(commentsUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const rawComment = await res.json();
      if (!res.ok) throw new Error(rawComment?.error);
      const comment: VroomkiComment = {
        id: rawComment.id,
        content: rawComment.content ?? rawComment.text ?? '',
        createdAt: rawComment.createdAt,
        author: rawComment.author ?? rawComment.user ?? me!,
        replyTo: rawComment.replyTo ?? null,
        likesCount: rawComment.likesCount ?? 0,
        isLiked: !!rawComment.isLiked,
      };
      setComments((prev) => [...prev, comment]);
      setText('');
      setReplyTo(null);
      onCommentAdded(post.id);
    } catch (e: any) {
      Toast.show({ type: 'error', text1: e?.message ?? 'Nie udało się dodać komentarza' });
    } finally {
      setPosting(false);
    }
  };

  const previewAuthor = me ?? (myId ? { id: myId, username: 'ty', avatarUrl: null, points: 0 } : null);
  const trimmed = text.trim();

  return (
    <Modal visible={!!post} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={{ flex: 1, backgroundColor: '#00000099', justifyContent: 'flex-end' }}>
          <Pressable style={{ flex: 1 }} onPress={onClose} />
          <View style={{
            maxHeight: '82%',
            backgroundColor: theme.surface,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            paddingTop: 12,
            paddingHorizontal: 16,
            paddingBottom: footerPaddingBottom,
          }}
          >
            <View style={{ width: 42, height: 4, borderRadius: 2, backgroundColor: theme.border3, alignSelf: 'center', marginBottom: 14 }} />
            <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 13, letterSpacing: 2, marginBottom: 4 }}>KOMENTARZE</Text>
            <Text style={{ color: theme.textDim, fontSize: 11, marginBottom: 12 }}>
              {comments.length} {comments.length === 1 ? 'komentarz' : 'komentarzy'}
            </Text>

            {loading ? (
              <ActivityIndicator color="#e33835" style={{ marginVertical: 30 }} />
            ) : (
              <FlatList
                data={comments}
                keyExtractor={(item) => `${item.legacyOnly ? 'legacy' : 'vroomki'}-${item.id}`}
                style={{ maxHeight: 300 }}
                contentContainerStyle={{ gap: 10, paddingBottom: 10 }}
                keyboardShouldPersistTaps="handled"
                ListEmptyComponent={(
                  <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 10, textAlign: 'center', marginVertical: 28 }}>
                    Bądź pierwszy w komentarzach
                  </Text>
                )}
                renderItem={({ item }) => (
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <Avatar user={item.author} size={34} />
                    <View style={{ flex: 1, backgroundColor: theme.surface2, borderRadius: 14, padding: 12 }}>
                      <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 11, fontWeight: '700' }} numberOfLines={1}>
                        {item.author.username}
                      </Text>
                      {item.replyTo && (
                        <Text style={{ fontFamily: 'Orbitron', color: '#e33835', fontSize: 10, marginTop: 5, opacity: 0.85 }}>
                          ↩ odpowiedź dla @{item.replyTo.username}
                        </Text>
                      )}
                      <Text style={{ color: theme.text, marginTop: 6, fontSize: 15, lineHeight: 22 }}>{item.content}</Text>
                      {useVroomkiCommentsApi && !item.legacyOnly && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: theme.border }}>
                          <TouchableOpacity
                            onPress={() => {
                              setReplyTo({ id: item.id, username: item.author.username });
                              inputRef.current?.focus();
                            }}
                            activeOpacity={0.85}
                            style={styles.actionBtn}
                          >
                            <MaterialIcons name="reply" size={16} color="#e33835" />
                            <Text style={styles.actionBtnText}>ODPOWIEDZ</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => likeComment(item.id)}
                            activeOpacity={0.85}
                            style={[styles.actionBtn, item.isLiked && { backgroundColor: '#e3383528', borderColor: '#e3383560' }]}
                          >
                            <MaterialCommunityIcons
                              name={item.isLiked ? 'heart' : 'heart-outline'}
                              size={18}
                              color={item.isLiked ? '#e33835' : theme.textDim}
                            />
                            <Text style={[styles.actionBtnText, { color: item.isLiked ? '#e33835' : theme.textDim }]}>
                              {item.likesCount ?? 0}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  </View>
                )}
              />
            )}

            {replyTo && (
              <View style={styles.replyBanner}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                  <MaterialIcons name="reply" size={18} color="#e33835" />
                  <Text style={{ fontFamily: 'Orbitron', color: '#e33835', fontSize: 11, fontWeight: '700' }} numberOfLines={1}>
                    Odpowiadasz @{replyTo.username}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setReplyTo(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <MaterialIcons name="close" size={20} color={theme.textDim} />
                </TouchableOpacity>
              </View>
            )}

            {trimmed.length > 0 && previewAuthor && (
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 10, marginBottom: 8, alignItems: 'flex-start' }}>
                <Avatar user={previewAuthor} size={32} />
                <View style={{
                  flex: 1,
                  backgroundColor: '#e3383512',
                  borderRadius: 16,
                  padding: 12,
                  borderWidth: 1,
                  borderColor: '#e3383540',
                }}
                >
                  <Text style={{ fontFamily: 'Orbitron', color: '#e33835', fontSize: 9, letterSpacing: 1, marginBottom: 6 }}>
                    PODGLĄD KOMENTARZA
                  </Text>
                  <Text style={{ color: theme.text, fontSize: 15, lineHeight: 22 }}>{trimmed}</Text>
                </View>
              </View>
            )}

            <View style={{
              flexDirection: 'row',
              alignItems: 'flex-end',
              gap: 10,
              paddingTop: 12,
              borderTopWidth: 1,
              borderTopColor: theme.border,
            }}
            >
              {previewAuthor && <Avatar user={previewAuthor} size={36} />}
              <View style={{ flex: 1 }}>
                <TextInput
                  ref={inputRef}
                  value={text}
                  onChangeText={setText}
                  placeholder={replyTo ? `Odpowiedz @${replyTo.username}...` : 'Napisz komentarz...'}
                  placeholderTextColor={theme.textDim}
                  multiline
                  maxLength={500}
                  style={{
                    minHeight: 44,
                    maxHeight: 110,
                    borderRadius: 18,
                    backgroundColor: theme.surface2,
                    color: theme.text,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    fontSize: 15,
                    lineHeight: 21,
                    borderWidth: 1,
                    borderColor: trimmed ? '#e3383540' : theme.border,
                  }}
                />
                {text.length > 0 && (
                  <Text style={{ color: theme.textDim, fontSize: 10, textAlign: 'right', marginTop: 4 }}>
                    {text.length}/500
                  </Text>
                )}
              </View>
              <TouchableOpacity
                onPress={send}
                disabled={posting || !trimmed}
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 23,
                  backgroundColor: '#e33835',
                  justifyContent: 'center',
                  alignItems: 'center',
                  opacity: posting || !trimmed ? 0.45 : 1,
                }}
              >
                {posting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <MaterialIcons name="send" size={20} color="#fff" />
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#e3383520',
    borderWidth: 1,
    borderColor: '#e3383540',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  actionBtnText: {
    fontFamily: 'Orbitron',
    color: '#e33835',
    fontSize: 10,
    fontWeight: '700',
  },
  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#e3383518',
    borderWidth: 1,
    borderColor: '#e3383540',
  },
});
