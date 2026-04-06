import React, { useEffect, useState } from 'react';
import {
  Modal, View, Text, ScrollView, TouchableOpacity,
  ActivityIndicator, Image, Platform, StyleSheet, Dimensions,
} from 'react-native';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import type {
  LeaderboardData, LeaderboardEntry,
  RunsData, RunEntry,
} from '../../hooks/useRouteLeaderboard';

const SCREEN_H = Dimensions.get('window').height;

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('pl-PL', { day: '2-digit', month: 'short', year: 'numeric' });
}
function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('pl-PL', { day: '2-digit', month: 'short' })
    + '  ' + d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
}

const MEDAL_COLOR  = ['#FFD700', '#C0C0C0', '#CD7F32'] as const;
const MEDAL_BG     = ['#FFD70015', '#C0C0C015', '#CD7F3215'] as const;
const MEDAL_BORDER = ['#FFD70040', '#C0C0C040', '#CD7F3240'] as const;

function Avatar({ uri, color, size = 34 }: { uri: string | null; color: string; size?: number }) {
  const { theme } = useTheme();
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: theme.surface2, borderWidth: 1.5, borderColor: `${color}55`,
      overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
    }}>
      {uri
        ? <Image source={{ uri }} style={{ width: size, height: size }} />
        : <MaterialCommunityIcons name="account" size={size * 0.5} color={color} />
      }
    </View>
  );
}

function LeaderboardRow({ entry }: { entry: LeaderboardEntry }) {
  const { theme } = useTheme();
  const isTop3 = entry.position <= 3;
  const color  = isTop3 ? MEDAL_COLOR[entry.position - 1] : entry.isMe ? theme.primary : theme.textDim;
  const bg     = isTop3 ? MEDAL_BG[entry.position - 1]   : entry.isMe ? `${theme.primary}10` : 'transparent';
  const border = isTop3 ? MEDAL_BORDER[entry.position - 1]: entry.isMe ? `${theme.primary}28` : theme.border;

  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: bg, borderRadius: 12,
      borderWidth: 1, borderColor: border,
      paddingHorizontal: 12, paddingVertical: 10, marginBottom: 6,
    }}>
      <View style={{ width: 28, alignItems: 'center', marginRight: 2 }}>
        {isTop3
          ? <MaterialIcons name="emoji-events" size={17} color={color} />
          : <Text style={{ color, fontFamily: 'Orbitron', fontSize: 10, fontWeight: '700' }}>{entry.position}</Text>
        }
      </View>
      <View style={{ marginHorizontal: 8 }}>
        <Avatar uri={entry.avatarUrl} color={color} size={32} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{
          color: entry.isMe ? theme.text : theme.textMuted,
          fontFamily: 'Orbitron', fontSize: 10,
          fontWeight: entry.isMe ? '700' : '400',
        }} numberOfLines={1}>
          {entry.username}{entry.isMe ? '  (Ty)' : ''}
        </Text>
        {!!entry.avgSpeed && (
          <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 7, marginTop: 1 }}>
            śr. {entry.avgSpeed.toFixed(0)} km/h
          </Text>
        )}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ color, fontFamily: 'Orbitron', fontSize: 13, fontWeight: '700', letterSpacing: 1 }}>
          {formatTime(entry.duration)}
        </Text>
        <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 7, marginTop: 2 }}>
          {formatDate(entry.createdAt)}
        </Text>
      </View>
    </View>
  );
}

function Podium({ entries }: { entries: LeaderboardEntry[] }) {
  const { theme } = useTheme();
  const slots   = [entries[1], entries[0], entries[2]];
  const heights = [70, 95, 58];
  const labels  = [2, 1, 3];
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end', gap: 8, marginBottom: 20 }}>
      {slots.map((entry, i) => {
        if (!entry) return <View key={i} style={{ width: 95 }} />;
        const color = MEDAL_COLOR[labels[i] - 1];
        return (
          <View key={entry.userId} style={{ alignItems: 'center', width: 95 }}>
            <Avatar uri={entry.avatarUrl} color={color} size={labels[i] === 1 ? 50 : 40} />
            <Text style={{
              color: theme.text, fontFamily: 'Orbitron',
              fontSize: labels[i] === 1 ? 9 : 8, fontWeight: '700',
              textAlign: 'center', marginTop: 5, marginBottom: 3,
            }} numberOfLines={1}>{entry.username}</Text>
            <Text style={{ color, fontFamily: 'Orbitron', fontSize: labels[i] === 1 ? 11 : 9, fontWeight: '900' }}>
              {formatTime(entry.duration)}
            </Text>
            <View style={{
              width: '100%', height: heights[i],
              backgroundColor: `${color}12`,
              borderTopWidth: 2, borderColor: color,
              borderTopLeftRadius: 6, borderTopRightRadius: 6,
              marginTop: 6, alignItems: 'center', paddingTop: 8,
            }}>
              <Text style={{ color, fontFamily: 'Orbitron', fontSize: 15, fontWeight: '900' }}>{labels[i]}</Text>
              <MaterialIcons name="emoji-events" size={13} color={color} style={{ marginTop: 3 }} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

function RunRow({ run }: { run: RunEntry; index: number }) {
  const { theme } = useTheme();
  const color = run.isMe ? theme.primary : theme.textDim;
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: run.isMe ? `${theme.primary}10` : theme.border,
      borderRadius: 10, borderWidth: 1,
      borderColor: run.isMe ? `${theme.primary}25` : theme.border2,
      paddingHorizontal: 12, paddingVertical: 9, marginBottom: 5,
    }}>
      <View style={{ marginHorizontal: 8 }}>
        <Avatar uri={run.avatarUrl} color={color} size={28} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{
          color: run.isMe ? theme.text : theme.textMuted,
          fontFamily: 'Orbitron', fontSize: 9,
          fontWeight: run.isMe ? '700' : '400',
        }} numberOfLines={1}>
          {run.username}{run.isMe ? ' (Ty)' : ''}
        </Text>
        <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 7, marginTop: 1 }}>
          {formatDateTime(run.createdAt)}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ color: run.isMe ? theme.primary : theme.textMuted, fontFamily: 'Orbitron', fontSize: 12, fontWeight: '700' }}>
          {formatTime(run.duration)}
        </Text>
        {!!run.avgSpeed && (
          <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 7, marginTop: 1 }}>
            śr. {run.avgSpeed.toFixed(0)} km/h
          </Text>
        )}
      </View>
    </View>
  );
}

function StatsBar({ stats }: { stats: RunsData['stats'] }) {
  const { theme } = useTheme();
  const items = [
    { icon: 'group',        label: 'GRACZY',  value: String(stats.uniqueUsers) },
    { icon: 'replay',       label: 'ŁĄCZNIE', value: String(stats.totalAttempts) },
    { icon: 'emoji-events', label: 'REKORD',  value: stats.bestTime ? formatTime(stats.bestTime) : '—' },
    { icon: 'timer',        label: 'ŚREDNI',  value: stats.avgTime  ? formatTime(stats.avgTime)  : '—' },
  ] as const;
  return (
    <View style={{ flexDirection: 'row', gap: 6, marginHorizontal: 16, marginBottom: 14, marginTop: 4 }}>
      {items.map(item => (
        <View key={item.label} style={{
          flex: 1, backgroundColor: theme.surface2,
          borderRadius: 10, borderWidth: 1, borderColor: theme.border,
          paddingVertical: 8, alignItems: 'center',
        }}>
          <MaterialIcons name={item.icon as any} size={14} color={theme.primary} />
          <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.text, fontWeight: '700', marginTop: 4 }}>
            {item.value}
          </Text>
          <Text style={{ fontFamily: 'Orbitron', fontSize: 6, color: theme.textDim, marginTop: 2, letterSpacing: 0.5 }}>
            {item.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

interface Props {
  visible:      boolean;
  routeId:      number | null;
  routeName:    string;
  data:         LeaderboardData | null;
  runsData:     RunsData | null;
  loading:      boolean;
  newTime?:     number | null;
  onClose:      () => void;
  onTabChange?: (tab: 'ranking' | 'runs') => void;
}

export function RouteLeaderboardModal({
  visible, routeId, routeName, data, runsData, loading, newTime, onClose, onTabChange,
}: Props) {
  const { theme, isDark } = useTheme();
  const [activeTab, setActiveTab] = useState<'ranking' | 'runs'>('ranking');

  useEffect(() => {
    if (visible) setActiveTab('ranking');
  }, [visible]);

  const top3       = data?.leaderboard.slice(0, 3) ?? [];
  const rest       = data?.leaderboard.slice(3)    ?? [];
  const myBest     = data?.myBest;
  const isRecord   = myBest?.position === 1 && newTime != null;
  const showPodium = top3.length >= 3;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: theme.overlay, justifyContent: 'flex-end' }}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />

        <View style={{
          height: SCREEN_H * 0.85,
          backgroundColor: theme.surface,
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
          borderColor: theme.border2,
          paddingBottom: Platform.OS === 'ios' ? 34 : 16,
          overflow: 'hidden',
        }}>
          {/* Handle */}
          <View style={{ width: 40, height: 4, backgroundColor: theme.border3, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 4 }} />

          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingTop: 12, paddingBottom: 14, borderBottomWidth: 1, borderColor: theme.border }}>
            <View style={{ backgroundColor: theme.primaryBg, borderRadius: 10, padding: 7, marginRight: 12, borderWidth: 1, borderColor: theme.primaryBorder }}>
              <MaterialIcons name="leaderboard" size={20} color={theme.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: theme.text, fontWeight: '700', letterSpacing: 1 }}>RANKING TRASY</Text>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, marginTop: 2 }} numberOfLines={1}>{routeName.toUpperCase()}</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <MaterialIcons name="close" size={20} color={theme.textDim} />
            </TouchableOpacity>
          </View>

          {/* Tabs */}
          <View style={{ flexDirection: 'row', marginHorizontal: 16, marginTop: 12, marginBottom: 4, backgroundColor: theme.surface2, borderRadius: 12, padding: 3 }}>
            {(['ranking', 'runs'] as const).map(tab => (
              <TouchableOpacity
                key={tab}
                style={[{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 10 },
                  activeTab === tab && { backgroundColor: theme.primary }]}
                onPress={() => { setActiveTab(tab); onTabChange?.(tab); }}
                activeOpacity={0.8}
              >
                <MaterialIcons
                  name={tab === 'ranking' ? 'emoji-events' : 'history'}
                  size={13}
                  color={activeTab === tab ? '#fff' : theme.textDim}
                />
                <Text style={{ fontFamily: 'Orbitron', fontSize: 9, fontWeight: '700', color: activeTab === tab ? '#fff' : theme.textDim }}>
                  {tab === 'ranking' ? 'RANKING' : 'PRZEBIEGI'}
                </Text>
                {tab === 'runs' && runsData && (
                  <View style={{ backgroundColor: activeTab === 'runs' ? '#ffffff30' : theme.border2, borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 }}>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: activeTab === 'runs' ? '#fff' : theme.textDim }}>
                      {runsData.stats.totalAttempts}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </View>

          {/* Mój nowy czas */}
          {newTime != null && (
            <View style={{
              marginHorizontal: 16, marginTop: 10,
              backgroundColor: isRecord ? '#FFD70012' : theme.primaryBg,
              borderRadius: 14, borderWidth: 1,
              borderColor: isRecord ? '#FFD70038' : theme.primaryBorder,
              padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12,
            }}>
              <MaterialIcons name={isRecord ? 'emoji-events' : 'timer'} size={24} color={isRecord ? '#FFD700' : theme.primary} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 7, letterSpacing: 2, color: isRecord ? '#FFD700' : theme.primary }}>
                  {isRecord ? '🏆 NOWY REKORD TRASY!' : 'TWÓJ CZAS'}
                </Text>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 22, fontWeight: '900', color: theme.text, letterSpacing: 2, marginTop: 2 }}>
                  {formatTime(newTime)}
                </Text>
              </View>
              {myBest && (
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: theme.textDim }}>POZYCJA</Text>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 20, fontWeight: '700', color: theme.textMuted }}>#{myBest.position}</Text>
                </View>
              )}
            </View>
          )}

          {runsData && <StatsBar stats={runsData.stats} />}

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 30 }} showsVerticalScrollIndicator={false}>
            {loading ? (
              <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                <ActivityIndicator size="large" color={theme.primary} />
                <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 10, marginTop: 14 }}>ŁADOWANIE...</Text>
              </View>
            ) : activeTab === 'ranking' ? (
              !data?.leaderboard.length ? (
                <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                  <MaterialIcons name="leaderboard" size={48} color={theme.border3} />
                  <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 10, marginTop: 14 }}>BRAK WYNIKÓW</Text>
                  <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 8, marginTop: 6 }}>Bądź pierwszy na tej trasie!</Text>
                </View>
              ) : (
                <>
                  {showPodium && <Podium entries={top3} />}
                  {(showPodium ? rest : data.leaderboard).map(entry => (
                    <LeaderboardRow key={entry.userId} entry={entry} />
                  ))}
                  {myBest && myBest.position > 50 && (
                    <>
                      <View style={{ alignItems: 'center', paddingVertical: 4 }}>
                        <Text style={{ color: theme.border3, fontFamily: 'Orbitron', fontSize: 9 }}>• • •</Text>
                      </View>
                      <LeaderboardRow entry={{
                        position: myBest.position, userId: 0, username: 'Ty',
                        avatarUrl: null, duration: myBest.duration, avgSpeed: myBest.avgSpeed,
                        maxSpeed: null, createdAt: myBest.createdAt, isMe: true,
                      }} />
                    </>
                  )}
                </>
              )
            ) : (
              !runsData?.runs.length ? (
                <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                  <MaterialIcons name="history" size={48} color={theme.border3} />
                  <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 10, marginTop: 14 }}>BRAK PRZEJAZDÓW</Text>
                </View>
              ) : (
                <>
                  <View style={{ flexDirection: 'row', paddingHorizontal: 12, marginBottom: 8 }}>
                    <Text style={{ width: 26, fontFamily: 'Orbitron', fontSize: 7, color: theme.textDim, textAlign: 'center' }}>#</Text>
                    <Text style={{ flex: 1, marginLeft: 46, fontFamily: 'Orbitron', fontSize: 7, color: theme.textDim }}>UŻYTKOWNIK</Text>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: theme.textDim }}>CZAS</Text>
                  </View>
                  {runsData.runs.map((run, i) => (
                    <RunRow key={run.id} run={run} index={i} />
                  ))}
                  {runsData.runs.length >= 100 && (
                    <Text style={{ textAlign: 'center', fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, marginTop: 8 }}>
                      Wyświetlono ostatnie 100 przejazdów
                    </Text>
                  )}
                </>
              )
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}