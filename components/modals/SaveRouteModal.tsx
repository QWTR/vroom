import React, { useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  Switch, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { useModalBackHandler } from '../../hooks/useModalBackHandler';

type Props = {
  visible:      boolean;
  pinCount:     number;
  distanceKm:   number;
  snapping:     boolean;
  isSnapped:    boolean;
  onSnapToRoad: () => void;
  onSave:       (name: string, description: string, isPublic: boolean, isOffroad: boolean) => void;
  onCancel:     () => void;
  saving:       boolean;
};

export function SaveRouteModal({
  visible, pinCount, distanceKm, snapping, isSnapped,
  onSnapToRoad, onSave, onCancel, saving,
}: Props) {
  const { theme } = useTheme();
  const [name,        setName]        = useState('');
  const [description, setDescription] = useState('');
  const [isPublic,    setIsPublic]    = useState(false);
  const [isOffroad,   setIsOffroad]   = useState(false);  // ← NOWE

  const handleSave = () => {
    if (!name.trim()) return;
    onSave(name.trim(), description.trim(), isPublic, isOffroad);
  };

  useModalBackHandler(visible, onCancel);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: theme.overlay }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        enabled={Platform.OS === 'ios'}
      >
        <View style={{
          backgroundColor: theme.surface,
          borderTopLeftRadius: 20, borderTopRightRadius: 20,
          padding: 24, paddingBottom: 40,
          borderTopWidth: 1, borderColor: theme.border2,
        }}>
          <View style={{ width: 40, height: 4, backgroundColor: theme.border3, borderRadius: 2, alignSelf: 'center', marginBottom: 20 }} />

          <Text style={{ fontFamily: 'Orbitron', fontSize: 14, color: theme.text, letterSpacing: 3, marginBottom: 4 }}>
            ZAPISZ TRASĘ
          </Text>
          <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim, letterSpacing: 2, marginBottom: 16 }}>
            {pinCount} punktów · {distanceKm.toFixed(1)} km
          </Text>

          {/* Snap to road — ukryj gdy offroad */}
          {!isOffroad && (
            <TouchableOpacity
              style={[{
                flexDirection: 'row', alignItems: 'center', gap: 8,
                borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 16,
                backgroundColor: isSnapped ? '#4de92612' : theme.border,
                borderColor:     isSnapped ? '#4de92640' : theme.border2,
              }, snapping && { opacity: 0.6 }]}
              onPress={onSnapToRoad}
              disabled={snapping || isSnapped}
              activeOpacity={0.8}
            >
              {snapping ? (
                <ActivityIndicator size="small" color={theme.text} />
              ) : (
                <MaterialCommunityIcons
                  name={isSnapped ? 'check-circle' : 'road-variant'}
                  size={16}
                  color={isSnapped ? '#4de926' : theme.text}
                />
              )}
              <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: isSnapped ? '#4de926' : theme.text, letterSpacing: 2 }}>
                {snapping ? 'DOPASOWUJĘ...' : isSnapped ? 'DOPASOWANO DO DROGI' : 'DOPASUJ DO DROGI'}
              </Text>
            </TouchableOpacity>
          )}

          {/* Offroad toggle */}
          <TouchableOpacity
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 8,
              borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 16,
              backgroundColor: isOffroad ? '#ff922b18' : theme.border,
              borderColor:     isOffroad ? '#ff922b60' : theme.border2,
            }}
            onPress={() => setIsOffroad(v => !v)}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons
              name="terrain"
              size={16}
              color={isOffroad ? '#ff922b' : theme.textDim}
            />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: isOffroad ? '#ff922b' : theme.text, letterSpacing: 2 }}>
                TRASA OFFROAD
              </Text>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: theme.textDim, marginTop: 2 }}>
                {isOffroad
                  ? 'Nawigacja w linii prostej między punktami'
                  : 'Nawigacja po drogach (standardowa)'}
              </Text>
            </View>
            <View style={{
              width: 20, height: 20, borderRadius: 10,
              backgroundColor: isOffroad ? '#ff922b' : theme.border2,
              alignItems: 'center', justifyContent: 'center',
            }}>
              {isOffroad && <MaterialIcons name="check" size={12} color="#fff" />}
            </View>
          </TouchableOpacity>

          <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, letterSpacing: 2, marginBottom: 6 }}>
            NAZWA TRASY *
          </Text>
          <TextInput
            style={{
              backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border2,
              borderRadius: 10, padding: 12, color: theme.text,
              fontFamily: 'Orbitron', fontSize: 11, marginBottom: 14,
            }}
            placeholder="np. Trasa przez góry"
            placeholderTextColor={theme.textDim}
            value={name}
            onChangeText={setName}
            maxLength={60}
          />

          <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, letterSpacing: 2, marginBottom: 6 }}>
            OPIS (opcjonalny)
          </Text>
          <TextInput
            style={{
              backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border2,
              borderRadius: 10, padding: 12, color: theme.text,
              fontFamily: 'Orbitron', fontSize: 11, marginBottom: 14,
              height: 72, textAlignVertical: 'top',
            }}
            placeholder="Opisz trasę..."
            placeholderTextColor={theme.textDim}
            value={description}
            onChangeText={setDescription}
            multiline
            maxLength={300}
          />

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 8 }}>
            <View>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.text, letterSpacing: 1 }}>PUBLICZNA</Text>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, marginTop: 2 }}>Widoczna dla innych użytkowników</Text>
            </View>
            <Switch
              value={isPublic}
              onValueChange={setIsPublic}
              trackColor={{ false: theme.border2, true: `${theme.primary}60` }}
              thumbColor={isPublic ? theme.primary : theme.textDim}
            />
          </View>

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
            <TouchableOpacity
              style={{ flex: 1, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: theme.border2, alignItems: 'center' }}
              onPress={onCancel}
            >
              <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.textDim }}>ANULUJ</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[{
                flex: 2, padding: 14, borderRadius: 12, backgroundColor: theme.primary,
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
              }, (!name.trim() || saving) && { opacity: 0.5 }]}
              onPress={handleSave}
              disabled={!name.trim() || saving}
            >
              {saving
                ? <ActivityIndicator size="small" color="#fff" />
                : <MaterialIcons name="save" size={16} color="#fff" />
              }
              <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: '#fff', fontWeight: '700' }}>ZAPISZ</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}