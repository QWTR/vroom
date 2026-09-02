import React, { useEffect, useRef } from 'react';
import { Modal, View, TouchableOpacity, StyleSheet, StatusBar, BackHandler } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { useModalBackHandler } from '../../hooks/useModalBackHandler';
import { SystemNewsPanel } from './SystemNewsPanel';

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function SystemNewsModal({ visible, onClose }: Props) {
  const { theme: t } = useTheme();
  const insets = useSafeAreaInsets();
  const newsBackRef = useRef<(() => boolean) | null>(null);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (newsBackRef.current?.()) return true;
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  useModalBackHandler(visible, onClose);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <StatusBar barStyle="light-content" backgroundColor={t.bg} />
      <SafeAreaView edges={['left', 'right', 'bottom']} style={[ss.root, { backgroundColor: t.bg }]}>
        <View style={[ss.header, { borderBottomColor: t.border2, paddingTop: insets.top + 8 }]}>
          <TouchableOpacity
            style={[ss.iconBtn, { backgroundColor: t.surface2, borderColor: t.border2 }]}
            onPress={onClose}
            hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
          >
            <MaterialIcons name="close" size={22} color={t.textMuted} />
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={[ss.headerTitle, { color: t.text }]}>NEWSY</Text>
            <Text style={[ss.headerSub, { color: t.textDim }]}>Motoryzacja · VROOM Radar</Text>
          </View>
          <View style={{ width: 48 }} />
        </View>
        <SystemNewsPanel
          active={visible}
          onRegisterBack={(handler) => { newsBackRef.current = handler; }}
        />
      </SafeAreaView>
    </Modal>
  );
}

const ss = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  iconBtn: {
    width: 48, height: 48, borderRadius: 15, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  headerSub: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 1, marginTop: 2 },
});
