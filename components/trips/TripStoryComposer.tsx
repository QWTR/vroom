import React, { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { MaterialIcons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import ViewShot, { captureRef } from 'react-native-view-shot';
import { saveImageToGallery } from '../../lib/saveImage';
import { TripStoryCard, type TripStoryData } from './TripStoryCard';

export function TripStoryComposer({
  visible,
  data,
  onClose,
}: {
  visible: boolean;
  data: TripStoryData;
  onClose: () => void;
}) {
  const captureNode = useRef<ViewShot>(null);
  const [activeAction, setActiveAction] = useState<'share' | 'save' | null>(null);

  const captureStory = async () => {
    await new Promise((resolve) => setTimeout(resolve, 180));
    return captureRef(captureNode, {
      format: 'png',
      quality: 1,
      width: 1080,
      height: 1920,
      result: 'tmpfile',
    });
  };

  const publishStory = async () => {
    if (activeAction) return;
    setActiveAction('share');
    try {
      const uri = await captureStory();
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('Grafika jest gotowa', 'Udostępnianie nie jest dostępne na tym urządzeniu.');
        return;
      }
      await Sharing.shareAsync(uri, {
        mimeType: 'image/png',
        UTI: 'public.png',
        dialogTitle: 'Opublikuj przejazd na Story',
      });
    } catch {
      Alert.alert('Nie udało się utworzyć grafiki', 'Spróbuj ponownie za chwilę.');
    } finally {
      setActiveAction(null);
    }
  };

  const downloadStory = async () => {
    if (activeAction) return;
    setActiveAction('save');
    try {
      const uri = await captureStory();
      if (await saveImageToGallery(uri)) {
        Alert.alert('Zapisano grafikę', 'VROOM Story znajdziesz w galerii zdjęć.');
      } else {
        Alert.alert('Brak dostępu do galerii', 'Zezwól aplikacji na dodawanie zdjęć i spróbuj ponownie.');
      }
    } catch {
      Alert.alert('Nie udało się zapisać grafiki', 'Spróbuj ponownie za chwilę.');
    } finally {
      setActiveAction(null);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.circleButton} disabled={Boolean(activeAction)}>
            <MaterialIcons name="close" size={23} color="#fff" />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>VROOM STORY</Text>
            <Text style={styles.subtitle}>Twoja trasa. Twoje statystyki. Twój moment.</Text>
          </View>
          <View style={styles.premiumChip}><MaterialIcons name="auto-awesome" size={14} color="#111" /><Text style={styles.premiumText}>VROOM</Text></View>
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.previewHalo}>
            <ViewShot ref={captureNode} options={{ format: 'png', quality: 1 }} style={styles.capture}>
              <TripStoryCard data={data} />
            </ViewShot>
          </View>
          <View style={styles.tipRow}>
            <MaterialIcons name="verified" size={17} color="#18e07b" />
            <Text style={styles.tip}>Grafika 1080×1920 jest gotowa do Instagram Stories, Facebooka, TikToka i wiadomości.</Text>
          </View>
          <TouchableOpacity onPress={publishStory} activeOpacity={0.88} style={styles.shareButton} disabled={Boolean(activeAction)}>
            {activeAction === 'share' ? <ActivityIndicator color="#111" /> : <><MaterialIcons name="ios-share" size={21} color="#111" /><Text style={styles.shareText}>OPUBLIKUJ NA STORY</Text></>}
          </TouchableOpacity>
          <TouchableOpacity onPress={downloadStory} activeOpacity={0.88} style={styles.downloadButton} disabled={Boolean(activeAction)}>
            {activeAction === 'save' ? <ActivityIndicator color="#fff" /> : <><MaterialIcons name="download" size={21} color="#fff" /><Text style={styles.downloadText}>POBIERZ DO GALERII</Text></>}
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={styles.secondaryButton} disabled={Boolean(activeAction)}>
            <Text style={styles.secondaryText}>WRÓĆ DO PODSUMOWANIA</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#050505' },
  header: { paddingTop: 52, paddingHorizontal: 18, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#ffffff10' },
  circleButton: { width: 43, height: 43, borderRadius: 22, borderWidth: 1, borderColor: '#ffffff20', backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1, marginHorizontal: 13 },
  title: { color: '#fff', fontFamily: 'Manrope_700Bold', fontSize: 15, letterSpacing: 1 },
  subtitle: { color: '#ffffff70', fontSize: 12, marginTop: 4 },
  premiumChip: { height: 30, borderRadius: 9, paddingHorizontal: 9, backgroundColor: '#ffd447', flexDirection: 'row', alignItems: 'center', gap: 4 },
  premiumText: { color: '#111', fontWeight: '900', fontSize: 12 },
  scrollContent: { padding: 18, paddingBottom: 42 },
  previewHalo: { borderRadius: 27, padding: 2, backgroundColor: '#ffd447', shadowColor: '#29c7ff', shadowOpacity: 0.36, shadowRadius: 28, shadowOffset: { width: 0, height: 10 }, elevation: 12 },
  capture: { width: '100%', aspectRatio: 9 / 16, borderRadius: 25, overflow: 'hidden', backgroundColor: '#030506' },
  tipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginTop: 18, paddingHorizontal: 4 },
  tip: { flex: 1, color: '#ffffff87', fontSize: 12, lineHeight: 16 },
  shareButton: { height: 58, borderRadius: 17, backgroundColor: '#ffd447', flexDirection: 'row', gap: 9, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  shareText: { color: '#111', fontFamily: 'Manrope_700Bold', fontSize: 12, letterSpacing: 1 },
  downloadButton: { height: 54, borderRadius: 17, borderWidth: 1, borderColor: '#ffffff28', backgroundColor: '#121212', flexDirection: 'row', gap: 9, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  downloadText: { color: '#fff', fontFamily: 'Manrope_700Bold', fontSize: 12, letterSpacing: 1 },
  secondaryButton: { height: 49, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  secondaryText: { color: '#ffffff6f', fontWeight: '900', fontSize: 12, letterSpacing: 1 },
});
