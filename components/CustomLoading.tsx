import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Easing } from 'react-native';
import { Text } from '@react-navigation/elements';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

export default function CustomLoading() {
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    // Animacja obrotu licznika
    Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 1500,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: true,
      })
    ).start();

    // Animacja pulsowania tekstu
    Animated.loop(
      Animated.sequence([
        Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(fadeAnim, { toValue: 0.4, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const spin = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={styles.container}>
      <Animated.View style={{ transform: [{ rotate: spin }] }}>
        <MaterialIcons name="speed" size={80} color="#e33835" />
      </Animated.View>
      
      <Animated.Text style={[styles.text, { opacity: fadeAnim }]}>
        INICJACJA SYSTEMÓW...
      </Animated.Text>
      
      <View style={styles.barContainer}>
        <View style={styles.bar} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f0f',
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    fontFamily: 'Orbitron',
    color: '#fff',
    marginTop: 30,
    fontSize: 12,
    letterSpacing: 2,
  },
  barContainer: {
    width: 200,
    height: 2,
    backgroundColor: '#1a1a1a',
    marginTop: 20,
    overflow: 'hidden',
  },
  bar: {
    width: '40%', // Tu można dodać animację paska postępu
    height: '100%',
    backgroundColor: '#e33835',
  }
});