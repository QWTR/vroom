import React, { useState } from 'react';
import { ActivityIndicator, Alert, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { LinearGradient } from 'expo-linear-gradient';
import * as WebBrowser from 'expo-web-browser';
import { API_URL } from '../../constants/config';
import { useReadability } from '../../contexts/ReadabilityContext';

type Props = {
  theme: { text: string; textDim: string; primary: string; border: string; surface: string };
};

export function VroomShopCard({ theme }: Props) {
  const [opening, setOpening] = useState(false);
  const { textScale } = useReadability();
  const { width, fontScale } = useWindowDimensions();
  const expandedLayout = Math.min(2, textScale * fontScale) >= 1.2 || width < 370;

  async function openShop() {
    if (opening) return;
    setOpening(true);
    try {
      const token = (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
      if (!token) throw new Error('Zaloguj się ponownie, aby otworzyć sklep.');
      const response = await fetch(`${API_URL}/api/auth/shop-handoff`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: '/shop' }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.url) throw new Error(data.error || 'Nie udało się otworzyć sklepu.');
      await WebBrowser.openBrowserAsync(data.url, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN });
    } catch (error) {
      Alert.alert('Sklep VROOM', error instanceof Error ? error.message : 'Nie udało się otworzyć sklepu.');
    } finally {
      setOpening(false);
    }
  }

  return <View style={{ paddingHorizontal: 20, marginBottom: 16 }}>
    <TouchableOpacity onPress={openShop} disabled={opening} activeOpacity={0.86} accessibilityRole="button" accessibilityLabel="Otwórz Sklep VROOM">
      <LinearGradient
        colors={['#2b070d', '#12070a', '#09090b']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          minHeight: expandedLayout ? 190 : 116,
          padding: 18,
          borderRadius: 22,
          borderWidth: 1,
          borderColor: '#f2193355',
          overflow: 'hidden',
          flexDirection: expandedLayout ? 'column' : 'row',
          alignItems: expandedLayout ? 'stretch' : 'center',
          gap: 16,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={{ width: 54, height: 54, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f21933' }}>
            <MaterialCommunityIcons name="shopping-outline" size={28} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#ff5368', fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 1, fontWeight: '900' }}>NOWY KANAŁ VROOM</Text>
            <Text style={{ color: theme.text, fontFamily: 'Manrope_600SemiBold', fontSize: 18, fontWeight: '900', marginTop: 5 }}>Sklep VROOM</Text>
          </View>
          {!expandedLayout && (opening ? <ActivityIndicator color="#ff5368" /> : <MaterialCommunityIcons name="arrow-top-right" size={24} color="#ff5368" />)}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 12 }}>
          <Text style={{ flex: 1, color: theme.textDim, fontSize: 14, marginTop: expandedLayout ? 0 : 5, lineHeight: 21 }}>
            Ubrania, akcesoria i cyfrowe itemy do Twojego ekwipunku.
          </Text>
          {expandedLayout && (opening ? <ActivityIndicator color="#ff5368" /> : <MaterialCommunityIcons name="arrow-top-right" size={28} color="#ff5368" />)}
        </View>
      </LinearGradient>
    </TouchableOpacity>
  </View>;
}
