import React, { useEffect, useState } from 'react';
import { View, TouchableOpacity, Modal, Pressable, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from '../ui/AppText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../../contexts/ThemeContext';
import { useFormKeyboardPadding } from '../../hooks/useKeyboardInset';
import { VroomkiStyledText } from './VroomkiStyledText';
import { VROOMKI_TEXT_COLORS, type VroomkiTextOverlay } from '../../lib/vroomkiTypes';

const TEXT_STYLES: Array<{ id: string; label: string; patch: Partial<VroomkiTextOverlay> }> = [
  { id: 'tiktok', label: 'TikTok', patch: { color: '#ffffff', strokeColor: '#000000', strokeWidth: 3, bgColor: null } },
  { id: 'neon', label: 'Neon', patch: { color: '#00e5ff', strokeColor: '#001a33', strokeWidth: 2, bgColor: null } },
  { id: 'box', label: 'Box', patch: { color: '#ffffff', strokeColor: '#000000', strokeWidth: 0, bgColor: '#000000aa' } },
  { id: 'clean', label: 'Clean', patch: { color: '#ffffff', strokeColor: '#000000', strokeWidth: 0, bgColor: null } },
];

export function VroomkiTextOverlayEditor({
  visible,
  onClose,
  overlays,
  onChange,
  selectedId,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  overlays: VroomkiTextOverlay[];
  onChange: (next: VroomkiTextOverlay[]) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { scrollPaddingBottom } = useFormKeyboardPadding(20);
  const selected = overlays.find((item) => item.id === selectedId) ?? null;
  const [draftText, setDraftText] = useState('');

  useEffect(() => {
    if (!visible) setDraftText('');
  }, [visible]);

  const previewOverlay: VroomkiTextOverlay = selected ?? {
    id: 'preview',
    text: draftText.trim() || 'Podgląd napisu',
    x: 0.5,
    y: 0.5,
    scale: 1,
    rotation: 0,
    color: '#ffffff',
    fontSize: 24,
    strokeColor: '#000000',
    strokeWidth: 2,
    bgColor: null,
  };

  const addOverlay = () => {
    const text = draftText.trim();
    if (!text) return;
    const overlay: VroomkiTextOverlay = {
      id: `overlay-${Date.now()}`,
      text,
      x: 0.5,
      y: 0.42,
      scale: 1,
      rotation: 0,
      color: '#ffffff',
      fontSize: 24,
      strokeColor: '#000000',
      strokeWidth: 2,
      bgColor: null,
    };
    onChange([...overlays, overlay]);
    onSelect(overlay.id);
    setDraftText('');
  };

  const patchSelected = (patch: Partial<VroomkiTextOverlay>) => {
    if (!selected) return;
    onChange(overlays.map((item) => (item.id === selected.id ? { ...item, ...patch } : item)));
  };

  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <View style={{ flex: 1, backgroundColor: '#000000cc', justifyContent: 'flex-end' }}>
          <Pressable style={{ flex: 1 }} onPress={onClose} />

          <View style={{
            maxHeight: '88%',
            backgroundColor: theme.surface,
            borderTopLeftRadius: 26,
            borderTopRightRadius: 26,
            paddingTop: 12,
            paddingHorizontal: 16,
            paddingBottom: Math.max(insets.bottom, 12),
          }}
          >
            <View style={{ width: 42, height: 4, borderRadius: 2, backgroundColor: theme.border3, alignSelf: 'center', marginBottom: 12 }} />
            <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.text, fontSize: 13, letterSpacing: 1, marginBottom: 10 }}>TEKST</Text>

            <View style={{
              height: 120,
              borderRadius: 16,
              backgroundColor: '#101010',
              marginBottom: 12,
              justifyContent: 'center',
              alignItems: 'center',
              overflow: 'hidden',
              borderWidth: 1,
              borderColor: theme.border,
            }}
            >
              <VroomkiStyledText overlay={previewOverlay} fontSize={22 * previewOverlay.scale} />
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: scrollPaddingBottom }}
            >
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                <TextInput
                  value={selected ? selected.text : draftText}
                  onChangeText={(text) => {
                    if (selected) patchSelected({ text });
                    else setDraftText(text);
                  }}
                  placeholder="Wpisz napis..."
                  placeholderTextColor={theme.textDim}
                  multiline
                  style={{
                    flex: 1,
                    minHeight: 48,
                    maxHeight: 96,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: theme.border,
                    backgroundColor: theme.surface2,
                    color: theme.text,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    textAlignVertical: 'top',
                  }}
                />
                {!selected && (
                  <TouchableOpacity onPress={addOverlay} style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: '#e33835', justifyContent: 'center', alignItems: 'center' }}>
                    <MaterialIcons name="add" size={22} color="#fff" />
                  </TouchableOpacity>
                )}
              </View>

              <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.textDim, fontSize: 12, letterSpacing: 1, marginBottom: 8 }}>STYL</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 12 }}>
                {TEXT_STYLES.map((preset) => {
                  const active = selected
                    && selected.strokeWidth === (preset.patch.strokeWidth ?? selected.strokeWidth)
                    && selected.bgColor === (preset.patch.bgColor ?? null)
                    && selected.color === preset.patch.color;
                  return (
                    <TouchableOpacity
                      key={preset.id}
                      onPress={() => selected && patchSelected(preset.patch)}
                      disabled={!selected}
                      style={{
                        paddingHorizontal: 14,
                        paddingVertical: 8,
                        borderRadius: 999,
                        backgroundColor: active ? '#e33835' : theme.surface2,
                        opacity: selected ? 1 : 0.5,
                      }}
                    >
                      <Text style={{ color: active ? '#fff' : theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12 }}>{preset.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {selected && (
                <>
                  <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.textDim, fontSize: 12, letterSpacing: 1, marginBottom: 8 }}>KOLOR TEKSTU</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 12 }}>
                    {VROOMKI_TEXT_COLORS.map((color) => (
                      <TouchableOpacity
                        key={color}
                        onPress={() => patchSelected({ color })}
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 17,
                          backgroundColor: color,
                          borderWidth: selected.color === color ? 2 : 0,
                          borderColor: '#e33835',
                        }}
                      />
                    ))}
                  </ScrollView>

                  <Text style={{ fontFamily: 'Manrope_600SemiBold', color: theme.textDim, fontSize: 12, letterSpacing: 1, marginBottom: 8 }}>OBWÓDKA</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    {[0, 1, 2, 3, 4].map((width) => (
                      <TouchableOpacity
                        key={width}
                        onPress={() => patchSelected({ strokeWidth: width, strokeColor: selected.strokeColor ?? '#000000' })}
                        style={{
                          minWidth: 42,
                          paddingHorizontal: 10,
                          paddingVertical: 8,
                          borderRadius: 12,
                          backgroundColor: (selected.strokeWidth ?? 0) === width ? '#e33835' : theme.surface2,
                          alignItems: 'center',
                        }}
                      >
                        <Text style={{ color: (selected.strokeWidth ?? 0) === width ? '#fff' : theme.textDim, fontSize: 12 }}>{width === 0 ? 'OFF' : width}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {(selected.strokeWidth ?? 0) > 0 && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 12 }}>
                      {['#000000', '#ffffff', '#e33835', '#ffd700'].map((color) => (
                        <TouchableOpacity
                          key={color}
                          onPress={() => patchSelected({ strokeColor: color })}
                          style={{
                            width: 34,
                            height: 34,
                            borderRadius: 17,
                            backgroundColor: color,
                            borderWidth: selected.strokeColor === color ? 2 : 0,
                            borderColor: '#e33835',
                          }}
                        />
                      ))}
                    </ScrollView>
                  )}

                  <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
                    <TouchableOpacity
                      onPress={() => patchSelected({ bgColor: selected.bgColor ? null : '#000000aa' })}
                      style={{ flex: 1, padding: 10, borderRadius: 12, backgroundColor: selected.bgColor ? '#e3383520' : theme.surface2, alignItems: 'center' }}
                    >
                      <Text style={{ color: theme.text, fontSize: 12 }}>{selected.bgColor ? 'Tło: ON' : 'Tło: OFF'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => patchSelected({ scale: Math.max(0.7, selected.scale - 0.1) })} style={{ padding: 10, backgroundColor: theme.surface2, borderRadius: 12 }}>
                      <MaterialIcons name="remove" size={20} color={theme.text} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => patchSelected({ scale: Math.min(2.2, selected.scale + 0.1) })} style={{ padding: 10, backgroundColor: theme.surface2, borderRadius: 12 }}>
                      <MaterialIcons name="add" size={20} color={theme.text} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        onChange(overlays.filter((item) => item.id !== selected.id));
                        onSelect(null);
                      }}
                      style={{ padding: 10, backgroundColor: '#e3383520', borderRadius: 12 }}
                    >
                      <MaterialIcons name="delete" size={20} color="#e33835" />
                    </TouchableOpacity>
                  </View>
                </>
              )}

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {overlays.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    onPress={() => onSelect(item.id)}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 999,
                      backgroundColor: selectedId === item.id ? '#e33835' : theme.surface2,
                    }}
                  >
                    <Text style={{ color: selectedId === item.id ? '#fff' : theme.textDim, fontSize: 12 }} numberOfLines={1}>
                      {item.text}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <TouchableOpacity onPress={onClose} style={{ marginTop: 16, alignSelf: 'center' }}>
                <Text style={{ color: theme.textDim, fontFamily: 'Manrope_600SemiBold', fontSize: 12 }}>GOTOWE</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
