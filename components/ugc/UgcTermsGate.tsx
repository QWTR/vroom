import React, { useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, ScrollView, Linking, ActivityIndicator,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../../contexts/ThemeContext';
import { acceptUgcTerms } from '../../lib/ugcActions';

const TERMS_URL = 'https://v-room.app/terms';
const PRIVACY_URL = 'https://v-room.app/privacy';

type Props = {
  visible: boolean;
  onAccepted: () => void;
};

export function UgcTermsGate({ visible, onAccepted }: Props) {
  const { theme } = useTheme();
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleAccept = async () => {
    if (!checked) return;
    setLoading(true);
    const ok = await acceptUgcTerms();
    setLoading(false);
    if (ok) {
      setChecked(false);
      onAccepted();
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen">
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 56 }}>
          <Text style={{ fontFamily: 'OrbitronBold', color: theme.text, fontSize: 18, marginBottom: 8 }}>
            Regulamin społeczności
          </Text>
          <Text style={{ color: theme.textMuted, fontSize: 14, lineHeight: 22, marginBottom: 16 }}>
            Aby korzystać z dyskusji, czatów i klubów, zaakceptuj zasady treści generowanych przez
            użytkowników (UGC). Obowiązuje zerowa tolerancja dla treści obraźliwych, wulgarnych,
            nękających lub niezgodnych z prawem.
          </Text>
          <Text style={{ color: theme.textMuted, fontSize: 14, lineHeight: 22, marginBottom: 16 }}>
            Możesz zgłaszać niewłaściwe treści i blokować użytkowników. Zespół VROOM rozpatruje
            zgłoszenia w ciągu 24 godzin — usuwa treści i może zawiesić konto sprawcy.
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
            <TouchableOpacity onPress={() => Linking.openURL(TERMS_URL)}>
              <Text style={{ color: '#e33835', fontSize: 13 }}>Regulamin</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => Linking.openURL(PRIVACY_URL)}>
              <Text style={{ color: '#e33835', fontSize: 13 }}>Polityka prywatności</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            onPress={() => setChecked((v) => !v)}
            style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}
          >
            <MaterialIcons
              name={checked ? 'check-box' : 'check-box-outline-blank'}
              size={24}
              color={checked ? '#e33835' : theme.textDim}
            />
            <Text style={{ flex: 1, color: theme.text, fontSize: 13, lineHeight: 20 }}>
              Akceptuję Regulamin i Politykę prywatności oraz zasady społeczności (zero tolerancji
              dla treści niedozwolonych).
            </Text>
          </TouchableOpacity>
        </ScrollView>
        <View style={{ padding: 20, borderTopWidth: 1, borderTopColor: theme.border }}>
          <TouchableOpacity
            onPress={handleAccept}
            disabled={!checked || loading}
            style={{
              backgroundColor: '#e33835',
              borderRadius: 14,
              paddingVertical: 14,
              alignItems: 'center',
              opacity: checked && !loading ? 1 : 0.45,
            }}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ fontFamily: 'OrbitronBold', color: '#fff', fontSize: 13 }}>
                AKCEPTUJĘ I KONTYNUUJĘ
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
