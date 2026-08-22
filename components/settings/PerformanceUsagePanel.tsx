import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Text, TouchableOpacity, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {
  clearPerformanceUsageSamples,
  readPerformanceUsageSamples,
  subscribePerformanceUsage,
  summarizePerformanceUsage,
  type PerformanceUsageSummary,
} from '../../lib/performance/usageDiagnostics';

const EMPTY = summarizePerformanceUsage([]);

function durationLabel(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function routeLabel(route: string): string {
  if (route.includes('spotmap')) return 'Mapa spotow';
  if (route.includes('/map')) return 'Mapa i jazda';
  if (route.includes('account') || route.includes('profile')) return 'Profil i ustawienia';
  if (route.includes('Community')) return 'Spolecznosc';
  if (route.includes('home') || route === '/') return 'Strona glowna';
  return route.replace(/^\/+/, '') || 'Aplikacja';
}

export function PerformanceUsagePanel({
  enabled,
  cardBg,
  border,
  text,
  textDim,
}: {
  enabled: boolean;
  cardBg: string;
  border: string;
  text: string;
  textDim: string;
}) {
  const [summary, setSummary] = useState<PerformanceUsageSummary>(EMPTY);

  const refresh = useCallback(() => {
    void readPerformanceUsageSamples().then(samples => setSummary(summarizePerformanceUsage(samples)));
  }, []);

  useEffect(() => {
    refresh();
    return subscribePerformanceUsage(refresh);
  }, [refresh]);

  if (!enabled) return null;

  const metrics = [
    { label: 'BATERIA', value: summary.batteryLevelPct == null ? '--' : `${summary.batteryLevelPct.toFixed(0)}%` },
    { label: 'ZUŻYCIE / H', value: summary.estimatedBatteryPctPerHour == null ? 'Zbieranie...' : `${summary.estimatedBatteryPctPerHour.toFixed(1)}%` },
    { label: 'SPADEK', value: summary.samples ? `${summary.batteryDropPct.toFixed(1)}%` : '--' },
    { label: 'ŚR. FPS', value: summary.samples ? summary.averageFps.toFixed(0) : '--' },
    { label: 'UTRACONE', value: summary.samples ? `${summary.droppedFramePct.toFixed(1)}%` : '--' },
    { label: 'ZADANIA / GPU', value: `${summary.activeTasks} / ${summary.heavySurfaces}` },
  ];

  const clear = () => {
    Alert.alert('Wyczyscic pomiary?', 'Historia zuzycia zostanie usunieta tylko z tego telefonu.', [
      { text: 'Anuluj', style: 'cancel' },
      { text: 'Wyczysc', style: 'destructive', onPress: () => void clearPerformanceUsageSamples() },
    ]);
  };

  return (
    <View style={{ marginTop: 12, padding: 14, borderRadius: 18, backgroundColor: cardBg, borderWidth: 1, borderColor: border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
        <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: '#4CAF50' }} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: text, fontFamily: 'Orbitron', fontSize: 11, fontWeight: '800' }}>POMIAR AKTYWNY</Text>
          <Text style={{ color: textDim, fontFamily: 'Orbitron', fontSize: 8, marginTop: 3 }}>Lokalna probka co 60 sekund</Text>
        </View>
        <Text style={{ color: textDim, fontFamily: 'Orbitron', fontSize: 9 }}>{durationLabel(summary.trackedMs)}</Text>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 13, gap: 8 }}>
        {metrics.map(metric => (
          <View key={metric.label} style={{ width: '31%', minWidth: 86, flexGrow: 1, padding: 10, borderRadius: 12, backgroundColor: '#00000018', borderWidth: 1, borderColor: border }}>
            <Text style={{ color: textDim, fontFamily: 'Orbitron', fontSize: 7, letterSpacing: 1 }}>{metric.label}</Text>
            <Text style={{ color: text, fontFamily: 'Orbitron', fontSize: 14, fontWeight: '900', marginTop: 5 }}>{metric.value}</Text>
          </View>
        ))}
      </View>

      {summary.routes.length > 0 ? (
        <View style={{ marginTop: 14 }}>
          <Text style={{ color: textDim, fontFamily: 'Orbitron', fontSize: 8, letterSpacing: 1.5, marginBottom: 7 }}>KOSZT EKRANOW</Text>
          {summary.routes.slice(0, 5).map(row => (
            <View key={row.route} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderTopWidth: 1, borderTopColor: border }}>
              <Text numberOfLines={1} style={{ color: text, fontFamily: 'Orbitron', fontSize: 9, flex: 1 }}>{routeLabel(row.route)}</Text>
              <Text style={{ color: textDim, fontFamily: 'Orbitron', fontSize: 8 }}>{durationLabel(row.trackedMs)} · {row.averageFps.toFixed(0)} FPS</Text>
              <Text style={{ color: '#e33835', fontFamily: 'Orbitron', fontSize: 8, width: 42, textAlign: 'right' }}>-{row.batteryDropPct.toFixed(1)}%</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={{ color: textDim, fontFamily: 'Orbitron', fontSize: 8, lineHeight: 14, textAlign: 'center', marginTop: 14 }}>
          Pierwszy zapis pojawi sie po okolo minucie aktywnego korzystania.
        </Text>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 8 }}>
        <MaterialIcons name="privacy-tip" size={15} color={textDim} />
        <Text style={{ color: textDim, fontFamily: 'Orbitron', fontSize: 7, lineHeight: 12, flex: 1 }}>
          Dane zostaja na tym urzadzeniu. Brak lokalizacji, tras i tresci uzytkownika.
        </Text>
        <TouchableOpacity onPress={clear} style={{ paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: border }}>
          <Text style={{ color: '#e33835', fontFamily: 'Orbitron', fontSize: 8, fontWeight: '800' }}>WYCZYSC</Text>
        </TouchableOpacity>
      </View>
      {summary.samples > 0 && summary.batteryLevelPct == null ? (
        <Text style={{ color: '#FF9800', fontFamily: 'Orbitron', fontSize: 7, lineHeight: 12, marginTop: 10 }}>
          Ten build nie ma natywnego czujnika baterii. FPS i koszt ekranow sa zapisywane; bateria bedzie dostepna po instalacji V1.0.29.
        </Text>
      ) : null}
    </View>
  );
}
