import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter }          from 'expo-router';
import DateTimePicker         from '@react-native-community/datetimepicker';
import MaterialIcons          from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme }           from '../../../contexts/ThemeContext';

export default function CreateMeet() {
  const router = useRouter();
  const { theme } = useTheme();

  const [formData, setFormData] = useState({
    title: '', description: '', location: '',
    date: new Date(), time: new Date(),
    maxParticipants: '', tags: '',
  });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  const onDateChange = (_: any, selectedDate?: Date) => {
    setShowDatePicker(false);
    if (selectedDate) setFormData(f => ({ ...f, date: selectedDate }));
  };
  const onTimeChange = (_: any, selectedTime?: Date) => {
    setShowTimePicker(false);
    if (selectedTime) setFormData(f => ({ ...f, time: selectedTime }));
  };

  const formatDate = (d: Date) => d.toLocaleDateString('pl-PL');
  const formatTime = (d: Date) => d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });

  const handleCreate = () => {
    console.log('Tworzenie spotkania:', formData);
    router.back();
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: theme.bg }}
    >
      <ScrollView style={{ flex: 1, paddingHorizontal: '5%' }} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={{ marginTop: 50, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 }}>
          <TouchableOpacity onPress={() => router.push('/Community/events')} style={{ padding: 5 }}>
            <MaterialIcons name="close" size={28} color={theme.text} />
          </TouchableOpacity>
          <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 18, letterSpacing: 2 }}>NOWY MEET</Text>
          <View style={{ width: 28 }} />
        </View>

        {/* Formularz */}
        <View style={{ gap: 5 }}>

          <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 10, marginBottom: 8, marginTop: 15, marginLeft: 5 }}>TYTUŁ SPOTKANIA</Text>
          <View style={{ backgroundColor: theme.surface3, borderRadius: 10, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: theme.border2, minHeight: 55 }}>
            <MaterialIcons name="title" size={20} color={theme.primary} />
            <TextInput
              style={{ flex: 1, fontFamily: 'Orbitron', color: theme.text, fontSize: 13, marginLeft: 10 }}
              placeholder="np. Nocny Cruise" placeholderTextColor={theme.textDim}
              onChangeText={val => setFormData(f => ({ ...f, title: val }))}
            />
          </View>

          {/* Data i godzina */}
          <View style={{ flexDirection: 'row' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 10, marginBottom: 8, marginTop: 15, marginLeft: 5 }}>DATA</Text>
              <TouchableOpacity
                style={{ backgroundColor: theme.surface3, borderRadius: 10, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: theme.border2, minHeight: 55 }}
                onPress={() => setShowDatePicker(true)}
              >
                <MaterialIcons name="event" size={20} color={theme.primary} />
                <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 13, marginLeft: 10 }}>{formatDate(formData.date)}</Text>
              </TouchableOpacity>
            </View>
            <View style={{ flex: 1, marginLeft: 15 }}>
              <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 10, marginBottom: 8, marginTop: 15, marginLeft: 5 }}>GODZINA</Text>
              <TouchableOpacity
                style={{ backgroundColor: theme.surface3, borderRadius: 10, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: theme.border2, minHeight: 55 }}
                onPress={() => setShowTimePicker(true)}
              >
                <MaterialIcons name="access-time" size={20} color={theme.primary} />
                <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 13, marginLeft: 10 }}>{formatTime(formData.time)}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {showDatePicker && <DateTimePicker value={formData.date} mode="date" display="default" onChange={onDateChange} minimumDate={new Date()} />}
          {showTimePicker && <DateTimePicker value={formData.time} mode="time" is24Hour display="default" onChange={onTimeChange} />}

          <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 10, marginBottom: 8, marginTop: 15, marginLeft: 5 }}>LOKALIZACJA</Text>
          <TouchableOpacity style={{ backgroundColor: theme.surface3, borderRadius: 10, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: theme.border2, minHeight: 55 }}>
            <MaterialIcons name="location-on" size={20} color={theme.primary} />
            <TextInput
              style={{ flex: 1, fontFamily: 'Orbitron', color: theme.text, fontSize: 13, marginLeft: 10 }}
              placeholder="Wybierz miejsce na mapie" placeholderTextColor={theme.textDim}
              onChangeText={val => setFormData(f => ({ ...f, location: val }))}
            />
            <MaterialIcons name="map" size={20} color={theme.textDim} />
          </TouchableOpacity>

          <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 10, marginBottom: 8, marginTop: 15, marginLeft: 5 }}>LIMIT UCZESTNIKÓW</Text>
          <View style={{ backgroundColor: theme.surface3, borderRadius: 10, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: theme.border2, minHeight: 55 }}>
            <MaterialIcons name="people" size={20} color={theme.primary} />
            <TextInput
              style={{ flex: 1, fontFamily: 'Orbitron', color: theme.text, fontSize: 13, marginLeft: 10 }}
              placeholder="np. 50" keyboardType="numeric" placeholderTextColor={theme.textDim}
              onChangeText={val => setFormData(f => ({ ...f, maxParticipants: val }))}
            />
          </View>

          <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 10, marginBottom: 8, marginTop: 15, marginLeft: 5 }}>OPIS WYDARZENIA</Text>
          <View style={{ backgroundColor: theme.surface3, borderRadius: 10, paddingHorizontal: 15, alignItems: 'flex-start', paddingTop: 12, borderWidth: 1, borderColor: theme.border2, minHeight: 55 }}>
            <TextInput
              style={{ flex: 1, fontFamily: 'Orbitron', color: theme.text, fontSize: 13, height: 100, textAlignVertical: 'top' }}
              placeholder="Opisz co będziemy robić..." placeholderTextColor={theme.textDim} multiline
              onChangeText={val => setFormData(f => ({ ...f, description: val }))}
            />
          </View>

          <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 10, marginBottom: 8, marginTop: 15, marginLeft: 5 }}>TAGI (po przecinku)</Text>
          <View style={{ backgroundColor: theme.surface3, borderRadius: 10, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: theme.border2, minHeight: 55 }}>
            <MaterialCommunityIcons name="tag-multiple" size={20} color={theme.primary} />
            <TextInput
              style={{ flex: 1, fontFamily: 'Orbitron', color: theme.text, fontSize: 13, marginLeft: 10 }}
              placeholder="JDM, NIGHT, DRIFT" placeholderTextColor={theme.textDim}
              onChangeText={val => setFormData(f => ({ ...f, tags: val }))}
            />
          </View>

          <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 25, padding: 15, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.border3, borderRadius: 10 }}>
            <MaterialIcons name="add-circle-outline" size={20} color={theme.textDim} />
            <Text style={{ fontFamily: 'Orbitron', color: theme.textDim, fontSize: 11 }}>DODAJ ZASADĘ REGULAMINU</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={{ backgroundColor: theme.primary, borderRadius: 12, paddingVertical: 18, alignItems: 'center', marginTop: 40 }}
          onPress={handleCreate}
        >
          <Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 14, fontWeight: 'bold', letterSpacing: 1 }}>OPUBLIKUJ SPOTKANIE</Text>
        </TouchableOpacity>

        <View style={{ height: 50 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}