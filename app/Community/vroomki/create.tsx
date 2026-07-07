import React, { useCallback, useEffect, useMemo, useState } from 'react';

import {

  View,

  Text,

  TouchableOpacity,

  TextInput,

  ScrollView,

  Image,

  ActivityIndicator,

  Dimensions,

  StyleSheet,

} from 'react-native';

import { useRouter } from 'expo-router';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LinearGradient } from 'expo-linear-gradient';

import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import AsyncStorage from '@react-native-async-storage/async-storage';

import Toast from 'react-native-toast-message';

import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useTheme } from '../../../contexts/ThemeContext';

import { API_URL } from '../../../constants/config';

import { VroomkiMediaPreview } from '../../../components/vroomki/VroomkiMediaPreview';

import { VroomkiTextOverlayEditor } from '../../../components/vroomki/VroomkiTextOverlayEditor';

import { VroomkiSoundPicker } from '../../../components/vroomki/VroomkiSoundPicker';

import { VroomkiDraggableOverlay, VroomkiSnapGuides } from '../../../components/vroomki/VroomkiDraggableOverlay';

import { VroomkiDurationPanel } from '../../../components/vroomki/VroomkiDurationPanel';

import { useVroomkiSoundPlayback } from '../../../hooks/useVroomkiSoundPlayback';

import {

  consumeVroomkiDraft,

  setVroomkiFocusPostId,

  type VroomkiDraft,

  type VroomkiSound,

} from '../../../lib/vroomkiTypes';



const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const PREVIEW_W = SCREEN_W - 28;

const PREVIEW_H = Math.min(SCREEN_H * 0.56, 580);



interface GarageCar {

  id: number;

  brand: string;

  specs: string;

  isMain: boolean;

  photos: string[];

}



const getToken = async () =>

  (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));



function StepPill({ label, active, done }: { label: string; active: boolean; done: boolean }) {

  return (

    <View style={{

      flexDirection: 'row',

      alignItems: 'center',

      gap: 6,

      paddingHorizontal: 12,

      paddingVertical: 6,

      borderRadius: 999,

      backgroundColor: active ? '#e33835' : done ? '#e3383528' : '#ffffff10',

      borderWidth: 1,

      borderColor: active || done ? '#e33835' : '#ffffff18',

    }}

    >

      {done && !active ? (

        <MaterialIcons name="check" size={12} color="#e33835" />

      ) : (

        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: active ? '#fff' : '#ffffff55' }} />

      )}

      <Text style={{ fontFamily: 'Orbitron', color: active ? '#fff' : done ? '#e33835' : '#ffffff88', fontSize: 9, letterSpacing: 1 }}>

        {label}

      </Text>

    </View>

  );

}



function ToolButton({

  icon,

  label,

  active,

  onPress,

}: {

  icon: keyof typeof MaterialIcons.glyphMap;

  label: string;

  active?: boolean;

  onPress: () => void;

}) {

  return (

    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={{ alignItems: 'center', flex: 1 }}>

      <View style={{

        width: 56,

        height: 56,

        borderRadius: 18,

        backgroundColor: active ? '#e3383530' : '#ffffff12',

        justifyContent: 'center',

        alignItems: 'center',

        borderWidth: active ? 1.5 : 1,

        borderColor: active ? '#e33835' : '#ffffff18',

      }}

      >

        <MaterialIcons name={icon} size={24} color={active ? '#e33835' : '#fff'} />

      </View>

      <Text style={{ color: active ? '#e33835' : '#ffffffcc', fontSize: 9, marginTop: 7, fontFamily: 'Orbitron', letterSpacing: 0.5 }}>

        {label}

      </Text>

    </TouchableOpacity>

  );

}



export default function VroomkiCreateScreen() {

  const router = useRouter();

  const insets = useSafeAreaInsets();

  const { theme } = useTheme();



  const initialDraft = useMemo(() => consumeVroomkiDraft(), []);

  const [draft, setDraft] = useState<VroomkiDraft | null>(initialDraft);

  const [step, setStep] = useState<'edit' | 'publish'>('edit');

  const [textOpen, setTextOpen] = useState(false);

  const [soundOpen, setSoundOpen] = useState(false);

  const [durationOpen, setDurationOpen] = useState(false);

  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);

  const [snapGuides, setSnapGuides] = useState({ horizontal: false, vertical: false });

  const [caption, setCaption] = useState('');

  const [garageCars, setGarageCars] = useState<GarageCar[]>([]);

  const [selectedCarId, setSelectedCarId] = useState<number | null>(null);

  const [posting, setPosting] = useState(false);

  const [previewMediaReady, setPreviewMediaReady] = useState(true);



  const hasVideo = !!draft?.video;

  const previewSound = draft?.useOriginalAudio ? null : draft?.sound;



  useVroomkiSoundPlayback({

    active: step === 'edit' && !!previewSound?.audioUrl,

    sound: previewSound,

    soundStartMs: draft?.soundStartMs ?? 0,

    waitForMedia: hasVideo,

    mediaReady: hasVideo ? previewMediaReady : true,

  });



  useEffect(() => {

    if (!draft?.video) setPreviewMediaReady(true);

  }, [draft?.video]);



  useEffect(() => {

    if (!draft) router.back();

  }, [draft, router]);



  useEffect(() => {

    if (!draft?.preselectedSoundId) return;

    (async () => {

      try {

        const token = await getToken();

        const res = await fetch(`${API_URL}/api/vroomki/sounds/${draft.preselectedSoundId}`, {

          headers: { Authorization: `Bearer ${token}` },

        });

        if (!res.ok) return;

        const sound: VroomkiSound = await res.json();

        setDraft((prev) => (prev ? { ...prev, sound, useOriginalAudio: false } : prev));

      } catch {

        // ignore

      }

    })();

  }, [draft?.preselectedSoundId]);



  useEffect(() => {

    (async () => {

      try {

        const token = await getToken();

        const res = await fetch(`${API_URL}/api/cars`, { headers: { Authorization: `Bearer ${token}` } });

        const data = await res.json();

        setGarageCars(Array.isArray(data) ? data : data.cars ?? []);

      } catch {

        // ignore

      }

    })();

  }, []);



  const patchDraft = useCallback((patch: Partial<VroomkiDraft>) => {

    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));

  }, []);



  const navigateToPublishedReel = (createdId: number | null) => {

    if (createdId) setVroomkiFocusPostId(createdId);

    router.back();

  };



  const handlePublish = async () => {

    if (!draft || posting) return;

    if (!caption.trim() && draft.photos.length === 0 && !draft.video && !selectedCarId) {

      Toast.show({ type: 'info', text1: 'Dodaj opis, media albo wybierz auto' });

      return;

    }

    setPosting(true);

    try {

      const token = await getToken();

      if (!token) throw new Error('Brak tokenu');



      const commonFields = {

        caption: caption.trim(),

        overlays: JSON.stringify(draft.overlays),

        soundStartMs: String(draft.soundStartMs ?? 0),

        photoDurationMs: String(draft.photoDurationMs ?? 3000),

        clipStartMs: String(draft.clipStartMs ?? 0),

        ...(draft.clipDurationMs ? { clipDurationMs: String(draft.clipDurationMs) } : {}),

        ...(selectedCarId ? { carId: String(selectedCarId) } : {}),

        ...(draft.useOriginalAudio ? { useOriginalAudio: 'true' } : {}),

        ...(draft.sound?.id ? { soundId: String(draft.sound.id) } : {}),

        ...(draft.sound?.spotifyTrackId ? { spotifyTrackId: draft.sound.spotifyTrackId } : {}),

        ...(draft.sound?.audiusTrackId ? { audiusTrackId: draft.sound.audiusTrackId } : {}),

        ...(draft.sound?.deezerTrackId ? { deezerTrackId: draft.sound.deezerTrackId } : {}),

        ...(draft.sound?.itunesTrackId ? { itunesTrackId: draft.sound.itunesTrackId } : {}),

      };



      let createdId: number | null = null;



      if (draft.video) {

        const FileSystem = await import('expo-file-system/legacy');

        const ext = draft.video.split('.').pop() ?? 'mp4';

        const result = await FileSystem.uploadAsync(`${API_URL}/api/vroomki`, draft.video, {

          httpMethod: 'POST',

          headers: { Authorization: `Bearer ${token}` },

          uploadType: FileSystem.FileSystemUploadType.MULTIPART,

          fieldName: 'video',

          mimeType: `video/${ext}`,

          parameters: commonFields,

        });

        const payload = result.body ? JSON.parse(result.body) : null;

        if (result.status !== 200 && result.status !== 201) {

          throw new Error(payload?.error ?? 'Błąd wysyłania filmu');

        }

        createdId = payload?.id ?? null;

      } else {

        const { prepareUploadImages } = await import('../../../lib/prepareUploadImages');

        const preparedPhotos = draft.photos.length ? await prepareUploadImages(draft.photos) : [];

        const form = new FormData();

        Object.entries(commonFields).forEach(([key, value]) => form.append(key, value));

        preparedPhotos.forEach((uri, i) => {

          form.append('photos', { uri, name: `vroomki_${i}.jpg`, type: 'image/jpeg' } as any);

        });

        const res = await fetch(`${API_URL}/api/vroomki`, {

          method: 'POST',

          headers: { Authorization: `Bearer ${token}` },

          body: form,

        });

        const payload = await res.json().catch(() => null);

        if (!res.ok) throw new Error(payload?.error ?? 'Nie udało się opublikować');

        createdId = payload?.id ?? null;

      }



      Toast.show({ type: 'success', text1: 'VROOMKA opublikowana!', text2: 'Oglądasz swój reels' });

      navigateToPublishedReel(createdId);

    } catch (e: any) {

      Toast.show({ type: 'error', text1: e?.message ?? 'Nie udało się opublikować' });

    } finally {

      setPosting(false);

    }

  };



  if (!draft) {

    return (

      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.bg }}>

        <ActivityIndicator color="#e33835" />

      </View>

    );

  }



  return (

    <GestureHandlerRootView style={{ flex: 1 }}>

      <LinearGradient colors={['#0a0a0a', '#120808', '#050505']} style={{ flex: 1, paddingTop: insets.top }}>

        <View style={styles.header}>

          <TouchableOpacity

            onPress={() => (step === 'publish' ? setStep('edit') : router.back())}

            style={styles.headerBtn}

          >

            <MaterialIcons name={step === 'publish' ? 'arrow-back' : 'close'} size={22} color="#fff" />

          </TouchableOpacity>



          <View style={{ alignItems: 'center', gap: 8 }}>

            <Text style={styles.headerTitle}>

              {step === 'edit' ? 'NOWA VROOMKA' : 'PUBLIKUJ'}

            </Text>

            <View style={{ flexDirection: 'row', gap: 8 }}>

              <StepPill label="EDYCJA" active={step === 'edit'} done={step === 'publish'} />

              <StepPill label="PUBLIKACJA" active={step === 'publish'} done={false} />

            </View>

          </View>



          <TouchableOpacity

            onPress={() => (step === 'edit' ? setStep('publish') : handlePublish())}

            disabled={posting}

            style={[styles.publishBtn, posting && { opacity: 0.6 }]}

          >

            {posting ? (

              <ActivityIndicator color="#fff" size="small" />

            ) : (

              <Text style={styles.publishBtnText}>{step === 'edit' ? 'DALEJ' : 'PUBLIKUJ'}</Text>

            )}

          </TouchableOpacity>

        </View>



        {step === 'edit' ? (

          <View style={{ flex: 1 }}>

            <View style={styles.previewFrame}>

              <View style={styles.previewInner} pointerEvents="box-none">

                <View pointerEvents="none">

                  <VroomkiMediaPreview

                    photos={draft.photos}

                    video={draft.video}

                    height={PREVIEW_H}

                    width={PREVIEW_W}

                    active

                    photoDurationMs={draft.photoDurationMs}

                    clipStartMs={draft.clipStartMs ?? 0}

                    clipDurationMs={draft.clipDurationMs}

                    overlays={[]}

                    muted={!!previewSound?.audioUrl || draft.useOriginalAudio}

                    onMediaReadyChange={setPreviewMediaReady}

                  />

                </View>

                <VroomkiSnapGuides width={PREVIEW_W} height={PREVIEW_H} snap={snapGuides} />

                {draft.overlays.map((overlay) => (

                  <VroomkiDraggableOverlay

                    key={overlay.id}

                    overlay={overlay}

                    width={PREVIEW_W}

                    height={PREVIEW_H}

                    selected={selectedOverlayId === overlay.id}

                    onSelect={() => setSelectedOverlayId(overlay.id)}

                    onSnapChange={setSnapGuides}

                    onChange={({ x, y, scale }) => {

                      patchDraft({

                        overlays: draft.overlays.map((item) => (

                          item.id === overlay.id ? { ...item, x, y, scale } : item

                        )),

                      });

                    }}

                  />

                ))}

              </View>

              <Text style={styles.previewHint}>Przeciągnij tekst · dwoma palcami powiększ · środek tekstu = snap</Text>

            </View>



            {(draft.sound || draft.useOriginalAudio) && (

              <View style={styles.soundChip}>

                <MaterialIcons name="music-note" size={14} color="#e33835" />

                <Text style={styles.soundChipText} numberOfLines={1}>

                  {draft.useOriginalAudio ? 'Oryginalny dźwięk z filmu' : `${draft.sound?.artist ? `${draft.sound.artist} — ` : ''}${draft.sound?.title}`}

                </Text>

              </View>

            )}



            {durationOpen && (

              <VroomkiDurationPanel

                hasVideo={hasVideo}

                photoCount={draft.photos.length}

                photoDurationMs={draft.photoDurationMs}

                clipDurationMs={draft.clipDurationMs}

                videoUri={draft.video}

                onPhotoDurationChange={(ms) => patchDraft({ photoDurationMs: ms })}

                onClipDurationChange={(ms) => patchDraft({ clipDurationMs: ms })}

              />

            )}



            <View style={styles.toolDock}>

              <LinearGradient colors={['#ffffff08', '#ffffff14']} style={styles.toolDockInner}>

                <ToolButton icon="title" label="TEKST" onPress={() => setTextOpen(true)} />

                <ToolButton icon="music-note" label="DŹWIĘK" active={!!draft.sound || draft.useOriginalAudio} onPress={() => setSoundOpen(true)} />

                <ToolButton icon="timer" label="CZAS" active={durationOpen} onPress={() => setDurationOpen((v) => !v)} />

              </LinearGradient>

            </View>

          </View>

        ) : (

          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 100 }} showsVerticalScrollIndicator={false}>

            <View style={styles.publishPreviewCard}>

              <VroomkiMediaPreview

                photos={draft.photos}

                video={draft.video}

                height={220}

                width={SCREEN_W - 32}

                active={false}

                photoDurationMs={draft.photoDurationMs}

                overlays={draft.overlays}

                muted

              />

              {caption.trim().length > 0 && (

                <View style={styles.captionPreview}>

                  <Text style={styles.captionPreviewLabel}>PODGLĄD OPISU</Text>

                  <Text style={styles.captionPreviewText}>{caption.trim()}</Text>

                </View>

              )}

            </View>



            <Text style={styles.sectionLabel}>OPIS</Text>

            <TextInput

              value={caption}

              onChangeText={setCaption}

              placeholder="Co pokazujesz? Setup, brzmienie, spot, mod..."

              placeholderTextColor={theme.textDim}

              multiline

              maxLength={300}

              style={[styles.captionInput, { borderColor: theme.border, backgroundColor: theme.surface2, color: theme.text }]}

            />

            <Text style={{ color: theme.textDim, fontSize: 10, textAlign: 'right', marginTop: 4 }}>{caption.length}/300</Text>



            <Text style={[styles.sectionLabel, { marginTop: 20 }]}>AUTO Z GARAŻU (OPCJONALNIE)</Text>

            <Text style={{ color: theme.textDim, fontSize: 11, marginBottom: 10 }}>Przypnij auto, które pokazujesz w reelsie</Text>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>

              {garageCars.map((car) => {

                const selected = selectedCarId === car.id;

                return (

                  <TouchableOpacity

                    key={car.id}

                    onPress={() => setSelectedCarId(selected ? null : car.id)}

                    activeOpacity={0.88}

                    style={[styles.carCard, {

                      borderColor: selected ? '#e33835' : theme.border,

                      backgroundColor: selected ? '#e3383518' : theme.surface2,

                    }]}

                  >

                    {car.photos[0] ? (

                      <Image source={{ uri: car.photos[0] }} style={styles.carImage} resizeMode="cover" />

                    ) : (

                      <View style={[styles.carImage, { backgroundColor: '#e3383510', justifyContent: 'center', alignItems: 'center' }]}>

                        <MaterialIcons name="directions-car" size={30} color="#e33835" />

                      </View>

                    )}

                    <Text style={{ fontFamily: 'Orbitron', color: theme.text, fontSize: 10, marginTop: 8 }} numberOfLines={1}>{car.brand}</Text>

                    {selected && (

                      <View style={styles.carSelectedBadge}>

                        <MaterialIcons name="check" size={12} color="#fff" />

                      </View>

                    )}

                  </TouchableOpacity>

                );

              })}

            </ScrollView>

          </ScrollView>

        )}



        {step === 'publish' && (

          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>

            <TouchableOpacity onPress={handlePublish} disabled={posting} style={styles.bigPublishBtn}>

              <LinearGradient colors={['#ff4d4a', '#e33835', '#b82a28']} style={styles.bigPublishGradient}>

                {posting ? (

                  <ActivityIndicator color="#fff" />

                ) : (

                  <>

                    <MaterialIcons name="rocket-launch" size={20} color="#fff" />

                    <Text style={styles.bigPublishText}>OPUBLIKUJ VROOMKĘ</Text>

                  </>

                )}

              </LinearGradient>

            </TouchableOpacity>

          </View>

        )}



        <VroomkiTextOverlayEditor

          visible={textOpen}

          onClose={() => setTextOpen(false)}

          overlays={draft.overlays}

          onChange={(overlays) => patchDraft({ overlays })}

          selectedId={selectedOverlayId}

          onSelect={setSelectedOverlayId}

        />



        <VroomkiSoundPicker

          visible={soundOpen}

          onClose={() => setSoundOpen(false)}

          hasVideo={hasVideo}

          selected={draft.useOriginalAudio

            ? { id: null, title: 'Oryginalny dźwięk', artist: '', sourceType: 'original', sourceId: 'draft' }

            : draft.sound}

          onSelect={(sound, opts) => {

            if (opts?.useOriginalAudio) {

              patchDraft({ sound: null, useOriginalAudio: true });

            } else {

              patchDraft({ sound, useOriginalAudio: false });

            }

          }}

        />

      </LinearGradient>

    </GestureHandlerRootView>

  );

}



const styles = StyleSheet.create({

  header: {

    flexDirection: 'row',

    alignItems: 'center',

    justifyContent: 'space-between',

    paddingHorizontal: 14,

    paddingVertical: 10,

  },

  headerBtn: {

    width: 40,

    height: 40,

    borderRadius: 20,

    backgroundColor: '#ffffff14',

    justifyContent: 'center',

    alignItems: 'center',

  },

  headerTitle: {

    fontFamily: 'Orbitron',

    color: '#fff',

    fontSize: 11,

    letterSpacing: 2,

    fontWeight: '800',

  },

  publishBtn: {

    minWidth: 88,

    height: 36,

    borderRadius: 18,

    backgroundColor: '#e33835',

    justifyContent: 'center',

    alignItems: 'center',

    paddingHorizontal: 14,

  },

  publishBtnText: {

    fontFamily: 'Orbitron',

    color: '#fff',

    fontSize: 10,

    fontWeight: '800',

    letterSpacing: 1,

  },

  previewFrame: {

    alignItems: 'center',

    marginTop: 4,

  },

  previewInner: {

    width: PREVIEW_W,

    height: PREVIEW_H,

    borderRadius: 22,

    overflow: 'hidden',

    borderWidth: 1.5,

    borderColor: '#e3383540',

    backgroundColor: '#000',

    shadowColor: '#e33835',

    shadowOpacity: 0.25,

    shadowRadius: 18,

    shadowOffset: { width: 0, height: 8 },

    elevation: 8,

  },

  previewHint: {

    color: '#ffffff66',

    fontSize: 10,

    marginTop: 10,

    fontFamily: 'Orbitron',

    letterSpacing: 0.5,

  },

  soundChip: {

    flexDirection: 'row',

    alignItems: 'center',

    gap: 8,

    alignSelf: 'center',

    marginTop: 12,

    backgroundColor: '#ffffff10',

    borderRadius: 999,

    paddingHorizontal: 14,

    paddingVertical: 8,

    maxWidth: '90%',

    borderWidth: 1,

    borderColor: '#ffffff18',

  },

  soundChipText: {

    color: '#ffffffcc',

    fontSize: 11,

    flexShrink: 1,

  },

  toolDock: {

    position: 'absolute',

    left: 16,

    right: 16,

    bottom: 20,

  },

  toolDockInner: {

    flexDirection: 'row',

    borderRadius: 22,

    paddingVertical: 14,

    paddingHorizontal: 10,

    borderWidth: 1,

    borderColor: '#ffffff18',

  },

  publishPreviewCard: {

    borderRadius: 20,

    overflow: 'hidden',

    borderWidth: 1,

    borderColor: '#ffffff18',

    backgroundColor: '#ffffff08',

    marginBottom: 18,

  },

  captionPreview: {

    padding: 14,

    borderTopWidth: 1,

    borderTopColor: '#ffffff14',

    backgroundColor: '#e3383510',

  },

  captionPreviewLabel: {

    fontFamily: 'Orbitron',

    color: '#e33835',

    fontSize: 9,

    letterSpacing: 1,

    marginBottom: 6,

  },

  captionPreviewText: {

    color: '#fff',

    fontSize: 14,

    lineHeight: 20,

  },

  sectionLabel: {

    fontFamily: 'Orbitron',

    color: '#ffffff88',

    fontSize: 9,

    letterSpacing: 1.5,

    marginBottom: 8,

  },

  captionInput: {

    minHeight: 110,

    borderRadius: 18,

    borderWidth: 1,

    padding: 14,

    fontFamily: 'Orbitron',

    fontSize: 12,

    textAlignVertical: 'top',

    lineHeight: 18,

  },

  carCard: {

    width: 136,

    borderRadius: 18,

    borderWidth: 1.5,

    padding: 8,

    position: 'relative',

  },

  carImage: {

    width: '100%',

    height: 78,

    borderRadius: 14,

  },

  carSelectedBadge: {

    position: 'absolute',

    top: 14,

    right: 14,

    width: 22,

    height: 22,

    borderRadius: 11,

    backgroundColor: '#e33835',

    justifyContent: 'center',

    alignItems: 'center',

  },

  bottomBar: {

    position: 'absolute',

    left: 0,

    right: 0,

    bottom: 0,

    paddingHorizontal: 16,

    paddingTop: 12,

    backgroundColor: '#0a0a0af0',

    borderTopWidth: 1,

    borderTopColor: '#ffffff12',

  },

  bigPublishBtn: {

    borderRadius: 18,

    overflow: 'hidden',

  },

  bigPublishGradient: {

    flexDirection: 'row',

    alignItems: 'center',

    justifyContent: 'center',

    gap: 10,

    paddingVertical: 16,

  },

  bigPublishText: {

    fontFamily: 'Orbitron',

    color: '#fff',

    fontSize: 12,

    fontWeight: '800',

    letterSpacing: 1,

  },

});

