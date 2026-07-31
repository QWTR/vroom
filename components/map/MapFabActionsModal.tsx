import React, { useCallback, useEffect, useRef } from 'react';
import {
  InteractionManager,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';

type FabAction = {
  key: string;
  label: string;
  icon: string;
  lib: 'mi' | 'mci';
  onPress: () => void;
};

type Props = {
  visible: boolean;
  isSpeechEnabled: boolean;
  onClose: () => void;
  onRoute: () => void;
  onCreateRoute: () => void;
  onFuel: () => void;
  onCenter: () => void;
  onManualPoint: () => void;
  onToggleSpeech: () => void;
  onReport: () => void;
  onSpot: () => void;
  onCamera: () => void;
  onLayers: () => void;
};

export function MapFabActionsModal({
  visible,
  isSpeechEnabled,
  onClose,
  onRoute,
  onCreateRoute,
  onFuel,
  onCenter,
  onManualPoint,
  onToggleSpeech,
  onReport,
  onSpot,
  onCamera,
  onLayers,
}: Props) {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const pendingActionRef = useRef<(() => void) | null>(null);

  const flushPendingAction = useCallback(() => {
    const action = pendingActionRef.current;
    if (!action) return;
    pendingActionRef.current = null;
    InteractionManager.runAfterInteractions(action);
  }, []);

  useEffect(() => {
    if (!visible && Platform.OS !== 'ios') flushPendingAction();
  }, [visible, flushPendingAction]);

  const closeWithoutAction = useCallback(() => {
    pendingActionRef.current = null;
    onClose();
  }, [onClose]);

  const closeThenRun = useCallback((action: () => void) => {
    pendingActionRef.current = action;
    onClose();
  }, [onClose]);

  const actions: FabAction[] = [
    { key: 'route', label: 'Trasa', icon: 'alt-route', lib: 'mi', onPress: onRoute },
    { key: 'createRoute', label: 'Twórz Trasę', icon: 'map-marker-path', lib: 'mci', onPress: onCreateRoute },
    { key: 'fuel', label: 'Paliwo', icon: 'gas-station', lib: 'mci', onPress: onFuel },
    { key: 'center', label: 'Centruj', icon: 'my-location', lib: 'mi', onPress: onCenter },
    { key: 'manualPoint', label: 'Punkt', icon: 'place', lib: 'mi', onPress: onManualPoint },
    {
      key: 'mute',
      label: isSpeechEnabled ? 'Wycisz' : 'Odcisz',
      icon: isSpeechEnabled ? 'volume-up' : 'volume-off',
      lib: 'mi',
      onPress: onToggleSpeech,
    },
    { key: 'alert', label: 'Zgłoś', icon: 'warning', lib: 'mi', onPress: onReport },
    { key: 'spot', label: 'Spoty', icon: 'map-marker-star', lib: 'mci', onPress: onSpot },
    { key: 'cam', label: 'Fotoradar', icon: 'camera-plus-outline', lib: 'mci', onPress: onCamera },
    { key: 'layers', label: 'Warstwy', icon: 'layers-outline', lib: 'mci', onPress: onLayers },
  ];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
      onRequestClose={closeWithoutAction}
      onDismiss={Platform.OS === 'ios' ? flushPendingAction : undefined}
    >
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={closeWithoutAction} />
        <View style={{
          backgroundColor: isDark ? '#141416' : '#f4f4f5',
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          paddingTop: 10,
          paddingHorizontal: 16,
          paddingBottom: (insets.bottom || 0) + 16,
          borderTopWidth: 1,
          borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
        }}>
          <View style={{
            width: 40,
            height: 4,
            borderRadius: 2,
            backgroundColor: isDark ? '#ffffff25' : '#00000020',
            alignSelf: 'center',
            marginBottom: 14,
          }} />
          <Text style={{
            fontFamily: 'Orbitron',
            fontSize: 12,
            color: theme.text,
            fontWeight: '900',
            letterSpacing: 1,
            marginBottom: 16,
          }}>
            AKCJE MAPY
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 14 }}>
            {actions.map(tile => (
              <TouchableOpacity
                key={tile.key}
                style={{
                  width: '23%',
                  minWidth: 72,
                  maxWidth: 110,
                  aspectRatio: 1,
                  borderRadius: 14,
                  backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#fff',
                  borderWidth: 1,
                  borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 6,
                }}
                onPress={() => closeThenRun(tile.onPress)}
                activeOpacity={0.85}
              >
                {tile.lib === 'mi' ? (
                  <MaterialIcons
                    name={tile.icon as keyof typeof MaterialIcons.glyphMap}
                    size={26}
                    color={tile.key === 'alert' ? '#e33835' : theme.textMuted}
                  />
                ) : (
                  <MaterialCommunityIcons
                    name={tile.icon as keyof typeof MaterialCommunityIcons.glyphMap}
                    size={26}
                    color={theme.textMuted}
                  />
                )}
                <Text style={{
                  fontFamily: 'Orbitron',
                  fontSize: 7,
                  color: theme.textDim,
                  marginTop: 6,
                  textAlign: 'center',
                }} numberOfLines={2}>
                  {tile.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            style={{ marginTop: 18, alignItems: 'center', paddingVertical: 12 }}
            onPress={closeWithoutAction}
          >
            <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.textDim }}>ZAMKNIJ</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
