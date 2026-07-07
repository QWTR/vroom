import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Video } from 'expo-av';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { TrackStartScrubber } from '../shared/TrackStartScrubber';

const PHOTO_DURATIONS = [2000, 2500, 3000, 4000, 5000, 7000, 10000];

function formatSec(ms: number) {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function VroomkiDurationPanel({
  hasVideo,
  photoCount,
  photoDurationMs,
  clipStartMs,
  clipDurationMs,
  videoUri,
  onPhotoDurationChange,
  onClipRangeChange,
}: {
  hasVideo: boolean;
  photoCount: number;
  photoDurationMs: number;
  clipStartMs: number;
  clipDurationMs: number | null;
  videoUri: string | null;
  onPhotoDurationChange: (ms: number) => void;
  onClipRangeChange: (startMs: number, durationMs: number) => void;
}) {
  const [videoDurationMs, setVideoDurationMs] = useState<number | null>(null);

  const totalPhotoMs = photoCount * photoDurationMs;

  useEffect(() => {
    if (!videoUri || !videoDurationMs) return;
    onClipRangeChange(clipStartMs, Math.max(1000, videoDurationMs - clipStartMs));
  }, [videoDurationMs]);

  const handleVideoStart = (ms: number) => {
    const dur = videoDurationMs ? Math.max(1000, videoDurationMs - ms) : (clipDurationMs ?? 60000);
    onClipRangeChange(ms, dur);
  };

  return (
    <View style={{ marginTop: 16, paddingHorizontal: 16 }}>
      {videoUri ? (
        <Video
          source={{ uri: videoUri }}
          style={{ width: 0, height: 0, opacity: 0 }}
          onLoad={(status) => {
            if (!status.isLoaded || !status.durationMillis) return;
            setVideoDurationMs(status.durationMillis);
          }}
        />
      ) : null}

      <Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 10, letterSpacing: 1, marginBottom: 10 }}>
        CZAS VROOMKI
      </Text>

      {!hasVideo && photoCount > 0 && (
        <>
          <Text style={{ color: '#ffffffaa', fontSize: 11, marginBottom: 8 }}>
            Czas na zdjęcie · łącznie ~{Math.round(totalPhotoMs / 1000)}s
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {PHOTO_DURATIONS.map((ms) => (
              <TouchableOpacity
                key={ms}
                onPress={() => onPhotoDurationChange(ms)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 999,
                  backgroundColor: photoDurationMs === ms ? '#e33835' : '#ffffff14',
                }}
              >
                <Text style={{ color: '#fff', fontSize: 11 }}>{ms / 1000}s</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      {hasVideo && videoDurationMs && (
        <>
          <Text style={{ color: '#ffffffaa', fontSize: 11, marginBottom: 4 }}>
            Film {formatSec(videoDurationMs)} · odtwarzany fragment {formatSec(clipDurationMs ?? videoDurationMs - clipStartMs)}
          </Text>
          <TrackStartScrubber
            valueMs={clipStartMs}
            maxMs={videoDurationMs}
            onChange={handleVideoStart}
            accent="#e33835"
            label="START FILMU"
            hint="Przeciągnij — vroomka zacznie się od tego miejsca i poleci do końca filmu."
          />
        </>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}>
        <MaterialIcons name="info-outline" size={14} color="#ffffff88" />
        <Text style={{ color: '#ffffff88', fontSize: 10, flex: 1 }}>
          Muzykę przytniesz ikoną nożyczek przy wybranym utworze.
        </Text>
      </View>
    </View>
  );
}
