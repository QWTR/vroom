import React, { useCallback, useEffect, useRef } from 'react';
import { InteractionManager, Modal, Platform, Pressable, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMapHudTheme as useTheme } from './useMapHudTheme';

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
  onConvoy: () => void;
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
  onConvoy,
  onSpot,
  onCamera,
  onLayers,
}: Props) {
  const { theme } = useTheme();
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
    { key: 'createRoute', label: 'Ułóż trasę', icon: 'map-marker-path', lib: 'mci', onPress: onCreateRoute },
    { key: 'fuel', label: 'Paliwo', icon: 'gas-station', lib: 'mci', onPress: onFuel },
    { key: 'center', label: 'Centruj', icon: 'my-location', lib: 'mi', onPress: onCenter },
    { key: 'manualPoint', label: 'Wskaż punkt', icon: 'place', lib: 'mi', onPress: onManualPoint },
    {
      key: 'mute',
      label: isSpeechEnabled ? 'Wycisz' : 'Odcisz',
      icon: isSpeechEnabled ? 'volume-up' : 'volume-off',
      lib: 'mi',
      onPress: onToggleSpeech,
    },
    { key: 'alert', label: 'Zgłoś', icon: 'warning', lib: 'mi', onPress: onReport },
    { key: 'convoy', label: 'Konwój', icon: 'car-multiple', lib: 'mci', onPress: onConvoy },
    { key: 'spot', label: 'Spoty', icon: 'map-marker-star', lib: 'mci', onPress: onSpot },
    { key: 'cam', label: 'Dodaj radar', icon: 'camera-plus-outline', lib: 'mci', onPress: onCamera },
    { key: 'layers', label: 'Warstwy', icon: 'layers-outline', lib: 'mci', onPress: onLayers },
  ];

  const groups = [
    { title: 'Twoja trasa', keys: ['route', 'createRoute', 'manualPoint', 'center'] },
    { title: 'W drodze', keys: ['fuel', 'alert', 'cam', 'mute'] },
    { title: 'Odkrywaj i ustawiaj', keys: ['convoy', 'spot', 'layers'] },
  ];
  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent
      onRequestClose={closeWithoutAction} onDismiss={Platform.OS === 'ios' ? flushPendingAction : undefined}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Zamknij menu mapy"
          style={[StyleSheet.absoluteFillObject, { backgroundColor: '#050B1480' }]} onPress={closeWithoutAction} />
        <View style={{ maxHeight: '88%', backgroundColor: theme.surface, borderTopLeftRadius: 30,
          borderTopRightRadius: 30, paddingTop: 10, paddingBottom: insets.bottom + 12,
          borderWidth: 1, borderColor: theme.border2 }}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border3, alignSelf: 'center', marginBottom: 20 }} />
          <View style={{ paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.text, fontSize: 24, fontWeight: '800' }}>Twoja mapa</Text>
              <Text style={{ color: theme.textMuted, fontSize: 13, marginTop: 4 }}>Wszystko, czego potrzebujesz w drodze.</Text>
            </View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Zamknij menu mapy" onPress={closeWithoutAction}
              style={{ width: 44, height: 44, borderRadius: 16, backgroundColor: theme.surface2, alignItems: 'center', justifyContent: 'center' }}>
              <MaterialIcons name="close" size={22} color={theme.text} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
            {groups.map(group => <View key={group.title}>
              <Text style={{ color: theme.textMuted, fontSize: 12, fontWeight: '700', marginTop: 20, marginBottom: 10 }}>{group.title}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {group.keys.map(key => actions.find(action => action.key === key)!).map(tile => (
                  <TouchableOpacity key={tile.key} accessibilityRole="button" accessibilityLabel={tile.label}
                    onPress={() => closeThenRun(tile.onPress)} activeOpacity={0.7}
                    style={{ width: '48%', minHeight: 64, flexDirection: 'row', gap: 10, padding: 12,
                      borderRadius: 18, backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border, alignItems: 'center' }}>
                    {tile.lib === 'mi'
                      ? <MaterialIcons name={tile.icon as keyof typeof MaterialIcons.glyphMap} size={23} color={tile.key === 'alert' ? theme.primary : theme.text} />
                      : <MaterialCommunityIcons name={tile.icon as keyof typeof MaterialCommunityIcons.glyphMap} size={23} color={theme.text} />}
                    <Text style={{ flex: 1, fontSize: 13, fontWeight: '700', color: theme.text }}>{tile.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>)}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
