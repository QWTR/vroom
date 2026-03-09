import React, { useState } from 'react';
import { 
  Text, 
  StyleSheet, 
  View, 
  ScrollView, 
  TextInput, 
  TouchableOpacity, 
  KeyboardAvoidingView, 
  Platform 
} from 'react-native';
import { useRouter } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';

// Icons
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

export default function CreateMeet() {
  const router = useRouter();

  // State dla formularza
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    location: '',
    date: new Date(),
    time: new Date(),
    maxParticipants: '',
    tags: '',
  });

  // State dla pickerów
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  const onDateChange = (event, selectedDate) => {
    setShowDatePicker(false);
    if (selectedDate) {
      setFormData({ ...formData, date: selectedDate });
    }
  };

  const onTimeChange = (event, selectedTime) => {
    setShowTimePicker(false);
    if (selectedTime) {
      setFormData({ ...formData, time: selectedTime });
    }
  };

  const formatDate = (date) => {
    return date.toLocaleDateString('pl-PL');
  };

  const formatTime = (time) => {
    return time.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  };

  const handleCreate = () => {
    console.log("Tworzenie spotkania:", formData);
    router.back();
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: '#0f0f0f' }}
    >
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.push("/Community/events")} style={styles.backBtn}>
            <MaterialIcons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>NOWY MEET</Text>
          <View style={{ width: 28 }} /> 
        </View>

        {/* Formularz */}
        <View style={styles.form}>
          
          <Text style={styles.inputLabel}>TYTUŁ SPOTKANIA</Text>
          <View style={styles.inputContainer}>
            <MaterialIcons name="title" size={20} color="#e33835" />
            <TextInput 
              style={styles.input}
              placeholder="np. Nocny Cruise"
              placeholderTextColor="#ffffff30"
              onChangeText={(val) => setFormData({...formData, title: val})}
            />
          </View>

          {/* Rząd z Datą i Godziną */}
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.inputLabel}>DATA</Text>
              <TouchableOpacity 
                style={styles.inputContainer} 
                onPress={() => setShowDatePicker(true)}
              >
                <MaterialIcons name="event" size={20} color="#e33835" />
                <Text style={styles.valueText}>{formatDate(formData.date)}</Text>
              </TouchableOpacity>
            </View>

            <View style={{ flex: 1, marginLeft: 15 }}>
              <Text style={styles.inputLabel}>GODZINA</Text>
              <TouchableOpacity 
                style={styles.inputContainer} 
                onPress={() => setShowTimePicker(true)}
              >
                <MaterialIcons name="access-time" size={20} color="#e33835" />
                <Text style={styles.valueText}>{formatTime(formData.time)}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Renderowanie Pickerów */}
          {showDatePicker && (
            <DateTimePicker
              value={formData.date}
              mode="date"
              display="default"
              onChange={onDateChange}
              minimumDate={new Date()}
            />
          )}

          {showTimePicker && (
            <DateTimePicker
              value={formData.time}
              mode="time"
              is24Hour={true}
              display="default"
              onChange={onTimeChange}
            />
          )}

          <Text style={styles.inputLabel}>LOKALIZACJA</Text>
          <TouchableOpacity style={styles.inputContainer}>
            <MaterialIcons name="location-on" size={20} color="#e33835" />
            <TextInput 
              style={styles.input}
              placeholder="Wybierz miejsce na mapie"
              placeholderTextColor="#ffffff30"
              onChangeText={(val) => setFormData({...formData, location: val})}
            />
            <MaterialIcons name="map" size={20} color="#ffffff40" />
          </TouchableOpacity>

          <Text style={styles.inputLabel}>LIMIT UCZESTNIKÓW</Text>
          <View style={styles.inputContainer}>
            <MaterialIcons name="people" size={20} color="#e33835" />
            <TextInput 
              style={styles.input}
              placeholder="np. 50"
              keyboardType="numeric"
              placeholderTextColor="#ffffff30"
              onChangeText={(val) => setFormData({...formData, maxParticipants: val})}
            />
          </View>

          <Text style={styles.inputLabel}>OPIS WYDARZENIA</Text>
          <View style={[styles.inputContainer, { alignItems: 'flex-start', paddingTop: 12 }]}>
            <TextInput 
              style={[styles.input, { height: 100, textAlignVertical: 'top' }]}
              placeholder="Opisz co będziemy robić..."
              placeholderTextColor="#ffffff30"
              multiline={true}
              onChangeText={(val) => setFormData({...formData, description: val})}
            />
          </View>

          <Text style={styles.inputLabel}>TAGI (po przecinku)</Text>
          <View style={styles.inputContainer}>
            <MaterialCommunityIcons name="tag-multiple" size={20} color="#e33835" />
            <TextInput 
              style={styles.input}
              placeholder="JDM, NIGHT, DRIFT"
              placeholderTextColor="#ffffff30"
              onChangeText={(val) => setFormData({...formData, tags: val})}
            />
          </View>

          <TouchableOpacity style={styles.addRuleBtn}>
              <MaterialIcons name="add-circle-outline" size={20} color="#ffffff60" />
              <Text style={styles.addRuleText}>DODAJ ZASADĘ REGULAMINU</Text>
          </TouchableOpacity>

        </View>

        <TouchableOpacity style={styles.submitBtn} onPress={handleCreate}>
          <Text style={styles.submitBtnText}>OPUBLIKUJ SPOTKANIE</Text>
        </TouchableOpacity>

        <View style={{ height: 50 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: '5%',
  },
  header: {
    marginTop: 50,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 30,
  },
  backBtn: {
    padding: 5,
  },
  headerTitle: {
    fontFamily: 'Orbitron',
    color: '#fff',
    fontSize: 18,
    letterSpacing: 2,
  },
  form: {
    gap: 5,
  },
  inputLabel: {
    fontFamily: 'Orbitron',
    color: '#ffffff60',
    fontSize: 10,
    marginBottom: 8,
    marginTop: 15,
    marginLeft: 5,
  },
  inputContainer: {
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    paddingHorizontal: 15,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ffffff10',
    minHeight: 55,
  },
  input: {
    flex: 1,
    fontFamily: 'Orbitron',
    color: '#fff',
    fontSize: 13,
    marginLeft: 10,
  },
  valueText: {
    fontFamily: 'Orbitron',
    color: '#fff',
    fontSize: 13,
    marginLeft: 10,
  },
  row: {
    flexDirection: 'row',
  },
  addRuleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 25,
    padding: 15,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#ffffff20',
    borderRadius: 10,
  },
  addRuleText: {
    fontFamily: 'Orbitron',
    color: '#ffffff60',
    fontSize: 11,
  },
  submitBtn: {
    backgroundColor: '#e33835',
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 40,
  },
  submitBtnText: {
    fontFamily: 'Orbitron',
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    letterSpacing: 1,
  }
});