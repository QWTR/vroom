import React, { useRef, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, TouchableOpacity, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import Toast from 'react-native-toast-message';
import { AppText as Text, AppTextInput as TextInput } from '../ui/AppText';
import { useTheme } from '../../contexts/ThemeContext';

export interface CarComment {
  id: number;
  text: string;
  createdAt: string;
  parentId?: number | null;
  user: { id: number; username: string; avatarUrl: string | null };
  replies?: CarComment[];
}

export function CarComments({ comments, count, ownerId, onSubmit }: {
  comments: CarComment[];
  count: number;
  ownerId: number;
  onSubmit: (text: string, parentId?: number) => Promise<void>;
}) {
  const { theme: t } = useTheme();
  const [text, setText] = useState('');
  const [replyText, setReplyText] = useState('');
  const [replyTo, setReplyTo] = useState<CarComment | null>(null);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const send = async (isReply: boolean) => {
    const draft = (isReply ? replyText : text).trim();
    if (!draft || sendingRef.current || (isReply && !replyTo)) return;
    sendingRef.current = true;
    setSending(true);
    try {
      await onSubmit(draft, isReply ? replyTo!.id : undefined);
      if (isReply) {
        setExpanded((previous) => new Set(previous).add(replyTo!.id));
        setReplyText('');
        setReplyTo(null);
      } else setText('');
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Nie wysłano', text2: error instanceof Error ? error.message : 'Spróbuj ponownie.' });
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const composer = (isReply: boolean) => (
    <View style={[s.composer, { backgroundColor: t.surface3, borderColor: isReply ? t.primaryBorder : t.border }]}>
      {isReply && <View style={s.replyLabel}>
        <MaterialIcons name="subdirectory-arrow-right" size={16} color={t.primaryText} />
        <Text style={{ flex: 1, color: t.primaryText, fontSize: 12 }} numberOfLines={1}>Odpowiadasz @{replyTo?.user.username}</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Anuluj odpowiedź" disabled={sending} onPress={() => { setReplyTo(null); setReplyText(''); }} style={s.close}>
          <MaterialIcons name="close" size={20} color={t.textMuted} />
        </TouchableOpacity>
      </View>}
      <View style={s.inputRow}>
        <TextInput
          testID={isReply ? 'car-reply-input' : 'car-comment-input'}
          accessibilityLabel={isReply ? 'Treść odpowiedzi' : 'Treść komentarza'}
          placeholder={isReply ? 'Napisz odpowiedź…' : 'Co myślisz o tym aucie?'}
          placeholderTextColor={t.textMuted}
          style={[s.input, { color: t.text }]}
          value={isReply ? replyText : text}
          onChangeText={isReply ? setReplyText : setText}
          editable={!sending} multiline maxLength={300} autoFocus={isReply}
        />
        <TouchableOpacity
          testID={isReply ? 'car-send-reply' : 'car-send-comment'}
          accessibilityRole="button" accessibilityLabel={isReply ? 'Wyślij odpowiedź' : 'Wyślij komentarz'}
          disabled={sending || !(isReply ? replyText : text).trim()}
          onPress={() => void send(isReply)}
          style={[s.send, { backgroundColor: t.primary, opacity: sending || !(isReply ? replyText : text).trim() ? 0.45 : 1 }]}
        >
          {sending ? <ActivityIndicator color={t.onPrimary} size="small" /> : <MaterialIcons name="arrow-upward" size={22} color={t.onPrimary} />}
        </TouchableOpacity>
      </View>
      {!!(isReply ? replyText : text).length && <Text style={[s.counter, { color: t.textMuted }]}>{(isReply ? replyText : text).length}/300</Text>}
    </View>
  );

  const commentRow = (comment: CarComment, isReply = false) => (
    <View style={s.commentRow}>
      <View style={[s.avatar, isReply && s.smallAvatar, { backgroundColor: t.primaryBg, borderColor: t.primaryBorder }]}>
        {comment.user.avatarUrl
          ? <Image source={{ uri: comment.user.avatarUrl }} style={StyleSheet.absoluteFill} />
          : <Text style={{ color: t.primaryText, fontWeight: '700' }}>{comment.user.username.charAt(0).toUpperCase()}</Text>}
      </View>
      <View style={s.body}>
        <View style={s.meta}>
          <Text style={{ color: t.text, fontWeight: '700', flexShrink: 1 }}>{comment.user.username}</Text>
          {comment.user.id === ownerId && <Text style={[s.owner, { color: t.primaryText, backgroundColor: t.primaryBg }]}>Właściciel</Text>}
        </View>
        <Text style={{ color: t.textMuted, fontSize: 12, marginTop: 2 }}>{new Date(comment.createdAt).toLocaleDateString('pl-PL')}</Text>
        <Text style={{ color: t.text, lineHeight: 22, marginTop: 6 }}>{comment.text}</Text>
        {!isReply && <TouchableOpacity
          testID={`car-reply-${comment.id}`} accessibilityRole="button" accessibilityLabel={`Odpowiedz użytkownikowi ${comment.user.username}`}
          disabled={sending} onPress={() => { setReplyTo(comment); if (replyTo?.id !== comment.id) setReplyText(''); }} style={s.replyButton}
        >
          <MaterialIcons name="reply" size={18} color={t.primaryText} />
          <Text style={{ color: t.primaryText, fontSize: 13, fontWeight: '700' }}>Odpowiedz</Text>
        </TouchableOpacity>}
      </View>
    </View>
  );

  return <View testID="car-comments">
    <View style={s.heading}>
      <Text style={{ color: t.text, fontSize: 20, fontWeight: '800' }}>Rozmowa o aucie</Text>
      <View style={[s.count, { backgroundColor: t.surface3 }]}><Text style={{ color: t.textMuted }}>{count}</Text></View>
    </View>
    {composer(false)}
    {comments.length === 0 && <View style={s.empty}>
      <MaterialIcons name="forum" size={32} color={t.primaryText} />
      <Text style={{ color: t.text, fontWeight: '700' }}>Rozpocznij rozmowę</Text>
      <Text style={{ color: t.textMuted, textAlign: 'center' }}>Zapytaj o modyfikacje albo zostaw dobre słowo.</Text>
    </View>}
    {comments.map((comment) => {
      const replies = comment.replies ?? [];
      const visible = expanded.has(comment.id) ? replies : replies.slice(0, 2);
      return <View key={comment.id} style={[s.thread, { borderBottomColor: t.border }]}>
        {commentRow(comment)}
        {!!replies.length && <View style={[s.replies, { borderLeftColor: t.primaryBorder }]}>
          {visible.map((reply) => <View key={reply.id} style={s.replyItem}>{commentRow(reply, true)}</View>)}
          {replies.length > 2 && <TouchableOpacity accessibilityRole="button" style={s.replyButton} onPress={() => setExpanded((previous) => {
            const next = new Set(previous); if (next.has(comment.id)) next.delete(comment.id); else next.add(comment.id); return next;
          })}>
            <Text style={{ color: t.primaryText, fontWeight: '700' }}>{expanded.has(comment.id) ? 'Zwiń odpowiedzi' : `Pokaż pozostałe odpowiedzi (${replies.length - 2})`}</Text>
          </TouchableOpacity>}
        </View>}
        {replyTo?.id === comment.id && <View style={s.replyComposer}>{composer(true)}</View>}
      </View>;
    })}
  </View>;
}

const s = StyleSheet.create({
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' },
  count: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  composer: { borderWidth: 1, borderRadius: 18, padding: 6, marginBottom: 8 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  input: { flex: 1, minHeight: 48, maxHeight: 130, paddingHorizontal: 10, paddingVertical: 12, fontSize: 14 },
  send: { width: 46, height: 46, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  counter: { textAlign: 'right', paddingHorizontal: 8, paddingBottom: 4, fontSize: 12 },
  replyLabel: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 10 },
  close: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  thread: { paddingVertical: 18, borderBottomWidth: StyleSheet.hairlineWidth },
  commentRow: { flexDirection: 'row', gap: 10 },
  avatar: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  smallAvatar: { width: 28, height: 28, borderRadius: 14 },
  body: { flex: 1, minWidth: 0 },
  meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  owner: { borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, fontSize: 11 },
  replyButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start' },
  replies: { marginLeft: 18, paddingLeft: 18, borderLeftWidth: 2 },
  replyItem: { paddingTop: 10, paddingBottom: 10 },
  replyComposer: { marginTop: 10 },
  empty: { alignItems: 'center', gap: 10, paddingVertical: 30, paddingHorizontal: 20 },
});
