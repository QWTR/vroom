import React, { type ReactNode } from 'react';
import {
  View, TextInput, TouchableOpacity, StyleSheet, Platform, Keyboard, Text,
} from 'react-native';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../contexts/ThemeContext';
import { CHAT_INPUT_MAX_HEIGHT, CHAT_INPUT_MIN_HEIGHT, VROOM_RED, VROOM_RED_DIM } from './constants';
import { ChatAttachmentPreviewBar } from './ChatAttachmentPreviewBar';
import { ChatReplyPreview } from './ChatReplyPreview';

type ReplyState = { username: string; preview: string } | null;
type EditState = { preview: string } | null;

type Props = {
  text: string;
  onChangeText: (t: string) => void;
  onSend: () => void;
  onAttach?: () => void;
  onClear?: () => void;
  placeholder?: string;
  disabled?: boolean;
  sending?: boolean;
  attachments?: string[];
  onRemoveAttachment?: (index: number) => void;
  replyTo?: ReplyState;
  onDismissReply?: () => void;
  editing?: EditState;
  onDismissEdit?: () => void;
  inputPaddingBottom?: number;
  maxLength?: number;
  showAttach?: boolean;
  showClear?: boolean;
  showVideoAttach?: boolean;
  hasVideo?: boolean;
  onAttachVideo?: () => void;
  onRemoveVideo?: () => void;
  sendIcon?: 'send' | 'check';
  overlay?: ReactNode;
  typingIndicator?: React.ReactNode;
};

export function ChatComposer({
  text,
  onChangeText,
  onSend,
  onAttach,
  onClear,
  placeholder = 'Napisz wiadomość...',
  disabled = false,
  sending = false,
  attachments = [],
  onRemoveAttachment,
  replyTo,
  onDismissReply,
  editing,
  onDismissEdit,
  inputPaddingBottom = 0,
  maxLength = 2000,
  showAttach = true,
  showClear = true,
  showVideoAttach = false,
  hasVideo = false,
  onAttachVideo,
  onRemoveVideo,
  sendIcon = 'send',
  overlay,
  typingIndicator,
}: Props) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [inputHeight, setInputHeight] = React.useState(CHAT_INPUT_MIN_HEIGHT);

  const canSend = !disabled && !sending && (text.trim().length > 0 || attachments.length > 0);

  // Jak w dyskusjach: safe-area w paddingBottom, klawiatura w marginBottom (nie odwrotnie).
  const safePad = insets.bottom > 0 ? insets.bottom : (Platform.OS === 'android' ? 10 : 16);
  const keyboardLift = inputPaddingBottom > 0 ? inputPaddingBottom : 0;

  return (
    <View style={[styles.shell, {
      backgroundColor: theme.surface,
      borderTopColor: theme.border,
      paddingBottom: safePad,
      marginBottom: keyboardLift,
    }]}>
      {replyTo && onDismissReply && (
        <ChatReplyPreview username={replyTo.username} preview={replyTo.preview} onDismiss={onDismissReply} />
      )}
      {editing && onDismissEdit && (
        <ChatReplyPreview username="" preview={editing.preview} mode="edit" onDismiss={onDismissEdit} />
      )}
      {attachments.length > 0 && onRemoveAttachment && (
        <ChatAttachmentPreviewBar uris={attachments} onRemove={onRemoveAttachment} />
      )}
      {hasVideo && onRemoveVideo && (
        <View style={[styles.videoPreview, { backgroundColor: theme.surface }]}>
          <View style={[styles.videoThumb, { backgroundColor: '#000', borderColor: theme.border }]}>
            <MaterialIcons name="videocam" size={18} color="#fff" />
          </View>
          <TouchableOpacity
            style={[styles.videoRemove, { backgroundColor: VROOM_RED, borderColor: theme.surface }]}
            onPress={onRemoveVideo}
          >
            <Feather name="x" size={10} color="#fff" />
          </TouchableOpacity>
        </View>
      )}
      {typingIndicator}
      {overlay}
      <View style={styles.row}>
        {showAttach && onAttach && (
          <TouchableOpacity
            style={[styles.iconBtn, { backgroundColor: theme.surface2, borderColor: theme.border }]}
            onPress={onAttach}
            disabled={disabled || sending}
          >
            <Feather name="image" size={18} color={theme.textDim} />
          </TouchableOpacity>
        )}

        {showVideoAttach && onAttachVideo && (
          <TouchableOpacity
            style={[styles.iconBtn, { backgroundColor: theme.surface2, borderColor: theme.border }]}
            onPress={onAttachVideo}
            disabled={disabled || sending || hasVideo}
          >
            <MaterialIcons name="videocam" size={18} color={theme.textDim} />
          </TouchableOpacity>
        )}

        <TextInput
          style={[
            styles.input,
            {
              color: theme.text,
              backgroundColor: theme.surface2,
              borderColor: theme.border,
              height: Math.max(CHAT_INPUT_MIN_HEIGHT, inputHeight),
            },
          ]}
          value={text}
          onChangeText={onChangeText}
          onContentSizeChange={e => {
            const h = e.nativeEvent.contentSize.height;
            setInputHeight(Math.min(h, CHAT_INPUT_MAX_HEIGHT));
          }}
          placeholder={placeholder}
          placeholderTextColor={theme.textDim}
          clearButtonMode="while-editing"
          multiline
          maxLength={maxLength}
          scrollEnabled={inputHeight >= CHAT_INPUT_MAX_HEIGHT}
          editable={!disabled && !sending}
        />

        {showClear && (
          <TouchableOpacity
            style={[styles.iconBtn, { backgroundColor: theme.surface2, borderColor: theme.border }]}
            onPress={() => {
              Keyboard.dismiss();
              onClear?.();
            }}
            disabled={disabled || sending}
          >
            <Feather name="x" size={16} color={theme.textDim} />
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.sendBtn, { backgroundColor: canSend ? VROOM_RED : VROOM_RED_DIM }]}
          onPress={onSend}
          disabled={!canSend}
        >
          <Feather name={sendIcon} size={17} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    borderTopWidth: 1,
    paddingTop: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 10,
    paddingTop: 10,
    gap: 8,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    borderWidth: 1,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoPreview: { flexDirection: 'row', paddingHorizontal: 14, paddingTop: 10 },
  videoThumb: {
    width: 58,
    height: 58,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoRemove: {
    position: 'absolute',
    top: 5,
    left: 68,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
});
