import React, { useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  Switch, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';

type Props = {
  visible:      boolean;
  pinCount:     number;
  distanceKm:   number;
  snapping:     boolean;
  isSnapped:    boolean;
  onSnapToRoad: () => void;
  onSave:       (name: string, description: string, isPublic: boolean) => void;
  onCancel:     () => void;
  saving:       boolean;
};

export function SaveRouteModal({
  visible, pinCount, distanceKm, snapping, isSnapped,
  onSnapToRoad, onSave, onCancel, saving,
}: Props) {
  const [name,        setName]        = useState('');
  const [description, setDescription] = useState('');
  const [isPublic,    setIsPublic]    = useState(false);

  const handleSave = () => {
    if (!name.trim()) return;
    onSave(name.trim(), description.trim(), isPublic);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={S.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={S.sheet}>
          <View style={S.handle} />

          <Text style={S.title}>ZAPISZ TRASĘ</Text>
          <Text style={S.sub}>{pinCount} punktów · {distanceKm.toFixed(1)} km</Text>

          {/* ── Snap to road ── */}
          <TouchableOpacity
            style={[S.snapBtn, isSnapped && S.snapBtnDone, snapping && { opacity: 0.6 }]}
            onPress={onSnapToRoad}
            disabled={snapping || isSnapped}
            activeOpacity={0.8}
          >
            {snapping ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <MaterialCommunityIcons
                name={isSnapped ? 'check-circle' : 'road-variant'}
                size={16}
                color={isSnapped ? '#4de926' : '#fff'}
              />
            )}
            <Text style={[S.snapTxt, isSnapped && { color: '#4de926' }]}>
              {snapping ? 'DOPASOWUJĘ...' : isSnapped ? 'DOPASOWANO DO DROGI' : 'DOPASUJ DO DROGI'}
            </Text>
          </TouchableOpacity>

          <Text style={S.label}>NAZWA TRASY *</Text>
          <TextInput
            style={S.input}
            placeholder="np. Trasa przez góry"
            placeholderTextColor="#ffffff25"
            value={name}
            onChangeText={setName}
            maxLength={60}
          />

          <Text style={S.label}>OPIS (opcjonalny)</Text>
          <TextInput
            style={[S.input, { height: 72, textAlignVertical: 'top' }]}
            placeholder="Opisz trasę..."
            placeholderTextColor="#ffffff25"
            value={description}
            onChangeText={setDescription}
            multiline
            maxLength={300}
          />

          <View style={S.publicRow}>
            <View>
              <Text style={S.publicLabel}>PUBLICZNA</Text>
              <Text style={S.publicSub}>Widoczna dla innych użytkowników</Text>
            </View>
            <Switch
              value={isPublic}
              onValueChange={setIsPublic}
              trackColor={{ false: '#ffffff15', true: '#e3383560' }}
              thumbColor={isPublic ? '#e33835' : '#ffffff40'}
            />
          </View>

          <View style={S.buttons}>
            <TouchableOpacity style={S.cancelBtn} onPress={onCancel}>
              <Text style={S.cancelTxt}>ANULUJ</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[S.saveBtn, (!name.trim() || saving) && { opacity: 0.5 }]}
              onPress={handleSave}
              disabled={!name.trim() || saving}
            >
              {saving
                ? <ActivityIndicator size="small" color="#fff" />
                : <MaterialIcons name="save" size={16} color="#fff" />
              }
              <Text style={S.saveTxt}>ZAPISZ</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const S = StyleSheet.create({
  overlay:     { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000088' },
  sheet:       { backgroundColor: '#111', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40, borderTopWidth: 1, borderColor: '#ffffff12' },
  handle:      { width: 40, height: 4, backgroundColor: '#ffffff20', borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  title:       { fontFamily: 'Orbitron', fontSize: 14, color: '#fff', letterSpacing: 3, marginBottom: 4 },
  sub:         { fontFamily: 'Orbitron', fontSize: 9, color: '#ffffff50', letterSpacing: 2, marginBottom: 16 },
  snapBtn:     { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#ffffff12', borderWidth: 1, borderColor: '#ffffff20', borderRadius: 10, padding: 12, marginBottom: 16 },
  snapBtnDone: { backgroundColor: '#4de92612', borderColor: '#4de92640' },
  snapTxt:     { fontFamily: 'Orbitron', fontSize: 9, color: '#fff', letterSpacing: 2 },
  label:       { fontFamily: 'Orbitron', fontSize: 8, color: '#ffffff50', letterSpacing: 2, marginBottom: 6 },
  input:       { backgroundColor: '#ffffff08', borderWidth: 1, borderColor: '#ffffff12', borderRadius: 10, padding: 12, color: '#fff', fontFamily: 'Orbitron', fontSize: 11, marginBottom: 14 },
  publicRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 8 },
  publicLabel: { fontFamily: 'Orbitron', fontSize: 10, color: '#fff', letterSpacing: 1 },
  publicSub:   { fontFamily: 'Orbitron', fontSize: 8, color: '#ffffff40', marginTop: 2 },
  buttons:     { flexDirection: 'row', gap: 10, marginTop: 20 },
  cancelBtn:   { flex: 1, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#ffffff15', alignItems: 'center' },
  cancelTxt:   { fontFamily: 'Orbitron', fontSize: 10, color: '#ffffff50' },
  saveBtn:     { flex: 2, padding: 14, borderRadius: 12, backgroundColor: '#e33835', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  saveTxt:     { fontFamily: 'Orbitron', fontSize: 10, color: '#fff', fontWeight: '700' },
});