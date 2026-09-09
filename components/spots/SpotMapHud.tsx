import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { AppText as Text } from '../ui/AppText';
import { useMapHudTheme } from '../map/useMapHudTheme';
import { CATEGORIES, CATEGORY_ICONS, type SpotCategory } from '../../constants/spotTypes';

type Props = {
  top: number; count: number; radius: number; loading: boolean; error: string | null; hasLoaded: boolean;
  satellite: boolean; picking: boolean; categories: SpotCategory[];
  onCategory: (category: SpotCategory) => void; onClear: () => void; onDistance: () => void;
  onList: () => void; onRefresh: () => void; onSatellite: () => void; onLocate: () => void;
  onAdd: () => void; onCancel: () => void;
};

export function SpotMapHud(p: Props) {
  const { theme: t } = useMapHudTheme();
  const [footerHeight, setFooterHeight] = useState(138);
  const surface = { backgroundColor: t.surface, borderColor: t.border2 };
  const action = (icon: keyof typeof MaterialIcons.glyphMap, label: string, onPress: () => void, selected = false) => (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }}
      onPress={onPress} activeOpacity={0.7} style={[s.action, selected && { backgroundColor: t.primaryBg }]}>
      <MaterialIcons name={icon} size={23} color={selected ? t.primary : t.text} />
      <Text style={[s.actionText, { color: selected ? t.primary : t.textMuted }]}>{label}</Text>
    </TouchableOpacity>
  );
  if (p.picking) return <View pointerEvents="box-none" style={StyleSheet.absoluteFillObject}>
    <View style={[s.top, { top: p.top }]}>
      <View style={[s.header, surface]}>
        <View style={[s.icon, { backgroundColor: t.primaryBg }]}><MaterialIcons name="add-location-alt" size={27} color={t.primary} /></View>
        <View style={s.copy}><Text style={[s.title, { color: t.text }]}>Nowa miejscówka</Text>
          <Text style={[s.subtitle, { color: t.textMuted }]}>Dotknij mapy w miejscu spotu.</Text></View>
      </View>
    </View>
    <TouchableOpacity accessibilityRole="button" onPress={p.onCancel} style={[s.cancel, surface]}>
      <MaterialIcons name="close" size={22} color={t.text} /><Text style={[s.buttonText, { color: t.text }]}>Anuluj wybór miejsca</Text>
    </TouchableOpacity>
  </View>;
  return <View pointerEvents="box-none" style={StyleSheet.absoluteFillObject}>
    <View pointerEvents="box-none" style={[s.top, { top: p.top }]}>
      <View style={[s.header, surface]}>
        <View style={[s.icon, { backgroundColor: t.primaryBg }]}><MaterialIcons name="explore" size={28} color={t.primary} /></View>
        <View style={s.copy}>
          <Text style={[s.title, { color: t.text }]}>Odkrywaj spoty</Text>
          <Text style={[s.subtitle, { color: t.textMuted }]}>Znajdź miejsce na kolejny wypad.</Text>
        </View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Odśwież spoty" accessibilityState={{ disabled: p.loading }}
          disabled={p.loading} onPress={p.onRefresh} style={[s.refresh, { backgroundColor: t.surface2 }]}>
          {p.loading ? <ActivityIndicator color={t.primary} /> : <MaterialIcons name="refresh" size={23} color={t.text} />}
        </TouchableOpacity>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filters}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Wszystkie kategorie" accessibilityState={{ selected: !p.categories.length }}
          onPress={p.onClear} style={[s.chip, surface, !p.categories.length && { backgroundColor: t.primary, borderColor: t.primary }]}>
          <MaterialIcons name="layers" size={19} color={!p.categories.length ? t.onPrimary : t.text} />
          <Text style={[s.chipText, { color: !p.categories.length ? t.onPrimary : t.text }]}>Wszystkie</Text>
        </TouchableOpacity>
        {CATEGORIES.map(category => {
          const selected = p.categories.includes(category);
          return <TouchableOpacity key={category} accessibilityRole="button" accessibilityState={{ selected }}
            onPress={() => p.onCategory(category)} style={[s.chip, surface, selected && { backgroundColor: t.primary, borderColor: t.primary }]}>
            <MaterialIcons name={CATEGORY_ICONS[category] as keyof typeof MaterialIcons.glyphMap} size={19} color={selected ? t.onPrimary : t.textMuted} />
            <Text style={[s.chipText, { color: selected ? t.onPrimary : t.text }]}>{category}</Text>
          </TouchableOpacity>;
        })}
      </ScrollView>
      {p.error && !p.loading ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Ponów pobieranie spotów" onPress={p.onRefresh}
        style={[s.notice, surface]}>
        <MaterialIcons name="cloud-off" size={20} color={t.warning} />
        <Text style={[s.noticeText, { color: t.text }]}>{p.hasLoaded ? 'Pokazujemy ostatnio pobrane spoty.' : 'Nie udało się pobrać spotów.'} Dotknij, aby ponowić.</Text>
      </TouchableOpacity> : null}
    </View>
    <View style={[s.rail, surface, { bottom: footerHeight + 28 }]}>
      {action('satellite-alt', 'Satelita', p.onSatellite, p.satellite)}
      <View style={{ height: 1, backgroundColor: t.border, marginHorizontal: 10 }} />
      {action('my-location', 'Centruj', p.onLocate)}
    </View>
    <View onLayout={event => setFooterHeight(event.nativeEvent.layout.height)} style={[s.bottom, surface]}>
      <View style={s.summary}>
        <View style={s.copy}>
          <Text style={[s.summaryTitle, { color: t.text }]}>{!p.hasLoaded && !p.error ? 'Szukamy miejscówek…' : p.error && !p.hasLoaded ? 'Czekamy na połączenie' : `${p.count} miejsc na mapie`}</Text>
          <Text style={[s.subtitle, { color: t.textMuted }]}>{!p.loading && !p.error && !p.count ? 'Zwiększ zasięg lub zmień kategorie.' : p.categories.length ? `Wybrane kategorie: ${p.categories.length}` : 'Wszystkie kategorie'}</Text>
        </View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Zmień zasięg, obecnie ${p.radius} kilometrów`} onPress={p.onDistance}
          style={[s.radius, { backgroundColor: t.surface2 }]}>
          <MaterialIcons name="radar" size={19} color={t.primary} />
          <Text style={[s.chipText, { color: t.text }]}>{p.radius} km</Text>
          <MaterialIcons name="expand-more" size={19} color={t.textMuted} />
        </TouchableOpacity>
      </View>
      <View style={s.buttons}>
        <TouchableOpacity accessibilityRole="button" onPress={p.onList} style={[s.listButton, { backgroundColor: t.surface2 }]}>
          <MaterialIcons name="format-list-bulleted" size={22} color={t.text} /><Text style={[s.buttonText, { color: t.text }]}>Zobacz listę</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" onPress={p.onAdd} style={[s.addButton, { backgroundColor: t.primary }]}>
          <MaterialIcons name="add-location-alt" size={22} color={t.onPrimary} /><Text style={[s.buttonText, { color: t.onPrimary }]}>Dodaj spot</Text>
        </TouchableOpacity>
      </View>
    </View>
  </View>;
}

const s = StyleSheet.create({
  top: { position: 'absolute', left: 12, right: 12, gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderWidth: 1, borderRadius: 24 },
  icon: { width: 46, height: 46, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0 }, title: { fontSize: 20, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { fontSize: 12, marginTop: 3, lineHeight: 17 }, refresh: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  filters: { gap: 8, paddingVertical: 2, paddingRight: 12 }, chip: { minHeight: 44, borderRadius: 16, borderWidth: 1, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 7 },
  chipText: { fontSize: 13, fontWeight: '700' }, notice: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 12, borderWidth: 1, borderRadius: 18 }, noticeText: { flex: 1, fontSize: 13, lineHeight: 18 },
  rail: { position: 'absolute', bottom: 166, right: 12, padding: 4, borderWidth: 1, borderRadius: 22 },
  action: { width: 58, minHeight: 54, borderRadius: 17, alignItems: 'center', justifyContent: 'center', gap: 3 }, actionText: { fontSize: 11, fontWeight: '700' },
  bottom: { position: 'absolute', bottom: 16, left: 12, right: 12, padding: 14, borderRadius: 26, borderWidth: 1, shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 }, summaryTitle: { fontSize: 16, fontWeight: '800' },
  radius: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 44, paddingHorizontal: 10, borderRadius: 15 },
  buttons: { flexDirection: 'row', gap: 8 }, listButton: { flex: 1, minHeight: 52, borderRadius: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  addButton: { flex: 1, minHeight: 52, borderRadius: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, buttonText: { fontSize: 13, fontWeight: '800' },
  cancel: { position: 'absolute', bottom: 20, left: 16, right: 16, minHeight: 56, borderRadius: 20, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
});
