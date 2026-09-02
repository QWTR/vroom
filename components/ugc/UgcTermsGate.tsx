import React, { useEffect, useState } from 'react';
import { View, Modal, TouchableOpacity, ScrollView, Linking, ActivityIndicator } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../../contexts/ThemeContext';
import { acceptUgcTerms } from '../../lib/ugcActions';
import { acceptRequiredLegalDocuments, getLegalAcceptanceStatus, RequiredLegalDocument } from '../../lib/legalActions';

const DOCUMENT_URLS: Record<string, string> = {
  platform_terms: 'https://v-room.app/terms',
  platform_privacy: 'https://v-room.app/privacy',
  community_rules: 'https://v-room.app/terms',
};

type Props = { visible: boolean; onAccepted: () => void };

export function UgcTermsGate({ visible, onAccepted }: Props) {
  const { theme } = useTheme();
  const [documents, setDocuments] = useState<RequiredLegalDocument[]>([]);
  const [acceptedIds, setAcceptedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    void getLegalAcceptanceStatus().then((status) => {
      setDocuments(status.missing || []);
      setAcceptedIds([]);
    });
  }, [visible]);

  const allChecked = documents.length ? documents.every((item) => acceptedIds.includes(item.currentVersion.id)) : acceptedIds.includes('legacy');
  const toggle = (id: string) => setAcceptedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const handleAccept = async () => {
    if (!allChecked) return;
    setLoading(true);
    const legacyAccepted = await acceptUgcTerms();
    const legalAccepted = documents.length ? await acceptRequiredLegalDocuments(documents.map((item) => item.currentVersion.id)) : true;
    setLoading(false);
    if (legacyAccepted && legalAccepted) onAccepted();
  };

  if (!visible) return null;
  const rows = documents.length ? documents : [{ key: 'legacy', name: 'Regulamin, polityka prywatności i zasady społeczności', currentVersion: { id: 'legacy', title: 'Dokumenty VROOM', version: 1 } }];
  return <Modal visible animationType="slide" presentationStyle="fullScreen"><View style={{ flex: 1, backgroundColor: theme.bg }}><ScrollView contentContainerStyle={{ padding: 24, paddingTop: 56 }}>
    <Text style={{ fontFamily: 'Manrope_700Bold', color: theme.text, fontSize: 18, marginBottom: 8 }}>Dokumenty VROOM</Text>
    <Text style={{ color: theme.textMuted, fontSize: 14, lineHeight: 22, marginBottom: 24 }}>Zaktualizowaliśmy dane spółki i dokumenty. Zaakceptuj każdą wymaganą wersję, aby korzystać z aplikacji.</Text>
    {rows.map((item) => <TouchableOpacity key={item.currentVersion.id} onPress={() => toggle(item.currentVersion.id)} style={{ padding: 16, marginBottom: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 12, borderWidth: 1, borderColor: acceptedIds.includes(item.currentVersion.id) ? theme.primary : theme.border, borderRadius: 14 }}>
      <MaterialIcons name={acceptedIds.includes(item.currentVersion.id) ? 'check-box' : 'check-box-outline-blank'} size={24} color={acceptedIds.includes(item.currentVersion.id) ? theme.primary : theme.textDim} />
      <View style={{ flex: 1 }}><Text style={{ color: theme.text, fontSize: 14, fontWeight: '700' }}>{item.currentVersion.title}</Text><Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 4 }}>Wersja {item.currentVersion.version}</Text>{DOCUMENT_URLS[item.key] && <TouchableOpacity onPress={() => Linking.openURL(DOCUMENT_URLS[item.key])}><Text style={{ color: theme.primary, marginTop: 10, fontSize: 12 }}>Przeczytaj dokument</Text></TouchableOpacity>}</View>
    </TouchableOpacity>)}
  </ScrollView><View style={{ padding: 20, borderTopWidth: 1, borderTopColor: theme.border }}><TouchableOpacity onPress={handleAccept} disabled={!allChecked || loading} style={{ backgroundColor: theme.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', opacity: allChecked && !loading ? 1 : 0.45 }}>{loading ? <ActivityIndicator color={theme.onPrimary} /> : <Text style={{ fontFamily: 'Manrope_700Bold', color: theme.onPrimary, fontSize: 13 }}>AKCEPTUJĘ I KONTYNUUJĘ</Text>}</TouchableOpacity></View></View></Modal>;
}
