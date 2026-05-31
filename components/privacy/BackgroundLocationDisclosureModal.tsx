import React, { useState, useMemo } from 'react';
import {
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../../contexts/ThemeContext';
import type { AppTheme } from '../../constants/theme';

type Props = {
  visible: boolean;
  onCancel: () => void;
  onAccept: () => void;
};

export function BackgroundLocationDisclosureModal({ visible, onCancel, onAccept }: Props) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [checked, setChecked] = useState(false);

  if (!visible) return null;

  const handleCancel = () => {
    setChecked(false);
    onCancel();
  };

  const handleAccept = () => {
    if (!checked) return;
    setChecked(false);
    onAccept();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={handleCancel}>
      <View style={styles.backdrop}>
        <SafeAreaView style={styles.safe}>
          <View style={styles.card}>
            <View style={styles.iconWrap}>
              <MaterialIcons name="location-on" size={34} color={theme.primary} />
            </View>

            <Text style={styles.title}>Zgoda na lokalizację w tle</Text>
            <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
              <Text style={styles.text}>
                VROOM zbiera i używa danych o lokalizacji także wtedy, gdy aplikacja działa w tle
                lub jest zamknięta.
              </Text>
              <Text style={styles.text}>
                Jest to potrzebne do liczenia kilometrów i statystyk przejazdu oraz aktywnej
                nawigacji. Jeśli włączysz widoczność na mapie, Twoja aktualna pozycja może
                być pokazywana innym kierowcom VROOM.
              </Text>
              <Text style={styles.text}>
                Możesz wyłączyć tę funkcję w każdej chwili w ustawieniu Profil &gt; Ustawienia &gt;
                Praca w tle albo w ustawieniach systemowych telefonu.
              </Text>
            </ScrollView>

            <Pressable style={styles.checkRow} onPress={() => setChecked(v => !v)}>
              <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                {checked && <MaterialIcons name="check" size={16} color={theme.onPrimary} />}
              </View>
              <Text style={styles.checkText}>
                Rozumiem i zgadzam się na używanie lokalizacji w tle przez VROOM.
              </Text>
            </Pressable>

            <View style={styles.actions}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={handleCancel} activeOpacity={0.85}>
                <Text style={styles.secondaryText}>Nie zgadzam się</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryBtn, !checked && styles.primaryBtnDisabled]}
                onPress={handleAccept}
                activeOpacity={0.85}
                disabled={!checked}
              >
                <Text style={styles.primaryText}>Zgadzam się i włączam</Text>
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: t.overlay,
      justifyContent: 'center',
      padding: 18,
    },
    safe: {
      width: '100%',
    },
    card: {
      backgroundColor: t.surface,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: t.primaryBorder,
      padding: 20,
      maxHeight: '92%',
    },
    iconWrap: {
      width: 62,
      height: 62,
      borderRadius: 20,
      backgroundColor: t.primaryBg,
      borderWidth: 1,
      borderColor: t.primaryBorder,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
    },
    title: {
      color: t.text,
      fontFamily: 'OrbitronBold',
      fontSize: 20,
      marginBottom: 14,
    },
    body: {
      maxHeight: 270,
    },
    text: {
      color: t.textMuted,
      fontFamily: 'Orbitron',
      fontSize: 13,
      lineHeight: 20,
      marginBottom: 12,
    },
    checkRow: {
      flexDirection: 'row',
      gap: 12,
      paddingVertical: 14,
      alignItems: 'center',
    },
    checkbox: {
      width: 24,
      height: 24,
      borderRadius: 7,
      borderWidth: 1,
      borderColor: t.border3,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxChecked: {
      backgroundColor: t.primary,
      borderColor: t.primary,
    },
    checkText: {
      flex: 1,
      color: t.text,
      fontFamily: 'Orbitron',
      fontSize: 12,
      lineHeight: 18,
    },
    actions: {
      gap: 10,
    },
    primaryBtn: {
      minHeight: 48,
      borderRadius: 14,
      backgroundColor: t.primary,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 14,
    },
    primaryBtnDisabled: {
      opacity: 0.45,
    },
    primaryText: {
      color: t.onPrimary,
      fontFamily: 'OrbitronBold',
      fontSize: 12,
      textAlign: 'center',
    },
    secondaryBtn: {
      minHeight: 46,
      borderRadius: 14,
      backgroundColor: t.border,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 14,
    },
    secondaryText: {
      color: t.textMuted,
      fontFamily: 'OrbitronBold',
      fontSize: 12,
    },
  });
}
