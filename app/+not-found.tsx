import { Link, Stack } from 'expo-router';
import { StyleSheet, View, TouchableOpacity } from 'react-native';
import { Text } from '@react-navigation/elements';

// Icons
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

export default function NotFoundScreen() {
  return (
    <>
      {/* Ukrywamy nagłówek systemowy, żeby nie psuł designu */}
      <Stack.Screen options={{ title: 'Błąd trasy', headerShown: false }} />
      
      <View style={styles.container}>
        {/* Ikona błędu w stylu VROOM */}
        <View style={styles.errorIconContainer}>
          <MaterialIcons name="report-problem" size={80} color="#e33835" />
          <View style={styles.glow} />
        </View>

        <Text style={styles.errorCode}>404</Text>
        <Text style={styles.title}>ZJECHAŁEŚ Z TRASY</Text>
        
        <Text style={styles.description}>
          Wygląda na to, że ta droga nie istnieje lub została zamknięta dla ruchu.
        </Text>

        {/* Przycisk powrotu stylizowany na resztę aplikacji */}
        <Link href="/" asChild>
          <TouchableOpacity style={styles.button}>
            <MaterialIcons name="home" size={20} color="#fff" style={{ marginRight: 10 }} />
            <Text style={styles.buttonText}>WRÓĆ DO BAZY</Text>
          </TouchableOpacity>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#0f0f0f', // Spójne tło aplikacji
  },
  errorIconContainer: {
    marginBottom: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: 100,
    height: 100,
    backgroundColor: '#e33835',
    borderRadius: 50,
    opacity: 0.2,
    filter: 'blur(20px)', // Dla web, w mobile zadziała shadow
  },
  errorCode: {
    fontFamily: 'Orbitron',
    fontSize: 64,
    color: '#e33835',
    fontWeight: 'bold',
    letterSpacing: 5,
  },
  title: {
    fontFamily: 'Orbitron',
    fontSize: 20,
    color: '#fff',
    marginBottom: 15,
    textAlign: 'center',
  },
  description: {
    fontFamily: 'Orbitron',
    fontSize: 12,
    color: '#ffffff60',
    textAlign: 'center',
    marginBottom: 40,
    lineHeight: 20,
    paddingHorizontal: 20,
  },
  button: {
    backgroundColor: '#e33835',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 12,
    // Cień dla efektu neonu
    shadowColor: "#e33835",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
  buttonText: {
    fontFamily: 'Orbitron',
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
});