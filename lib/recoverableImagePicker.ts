import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { DeviceEventEmitter, Platform } from 'react-native';
import { useEffect, useRef } from 'react';

const PENDING_OPERATION_KEY = '@vroom/image-picker/pending-operation';
const RECOVERED_RESULT_KEY = '@vroom/image-picker/recovered-result';

export const GPS_DISCONTINUITY_EVENT = 'vroom:gps-discontinuity';
export const RECOVERED_IMAGE_EVENT = 'vroom:image-picker-recovered';

type PendingOperation = {
  purpose: string;
  startedAt: number;
};

type RecoveredResult = PendingOperation & {
  result: ImagePicker.ImagePickerResult;
  recoveredAt: number;
};

function signalGpsDiscontinuity(phase: 'camera_open' | 'camera_return' | 'android_recovery') {
  DeviceEventEmitter.emit(GPS_DISCONTINUITY_EVENT, {
    reason: 'camera',
    phase,
    at: Date.now(),
  });
}

export async function launchRecoverableCameraAsync(
  purpose: string,
  options: ImagePicker.ImagePickerOptions,
): Promise<ImagePicker.ImagePickerResult> {
  const operation: PendingOperation = { purpose, startedAt: Date.now() };
  await AsyncStorage.setItem(PENDING_OPERATION_KEY, JSON.stringify(operation));
  signalGpsDiscontinuity('camera_open');

  try {
    const result = await ImagePicker.launchCameraAsync(options);
    await AsyncStorage.removeItem(PENDING_OPERATION_KEY);
    signalGpsDiscontinuity('camera_return');
    return result;
  } catch (error) {
    // Android may destroy MainActivity while its camera app is open. Keep the
    // operation descriptor so getPendingResultAsync() can route the recovered
    // photo back to the correct screen after process restoration.
    if (Platform.OS !== 'android') {
      await AsyncStorage.removeItem(PENDING_OPERATION_KEY);
    }
    signalGpsDiscontinuity('camera_return');
    throw error;
  }
}

export async function recoverPendingImagePickerResult(): Promise<void> {
  if (Platform.OS !== 'android') return;

  const operationRaw = await AsyncStorage.getItem(PENDING_OPERATION_KEY);
  if (!operationRaw) return;

  let operation: PendingOperation | null = null;
  try {
    operation = JSON.parse(operationRaw) as PendingOperation;
  } catch {
    await AsyncStorage.removeItem(PENDING_OPERATION_KEY);
    return;
  }

  try {
    const result = await ImagePicker.getPendingResultAsync();
    if (!result) return;
    if ('code' in result) {
      await AsyncStorage.removeItem(PENDING_OPERATION_KEY);
      signalGpsDiscontinuity('android_recovery');
      if (__DEV__) console.warn('[ImagePicker] Android returned a pending picker error', result.code, result.message);
      return;
    }

    const recovered: RecoveredResult = {
      ...operation,
      result,
      recoveredAt: Date.now(),
    };
    await AsyncStorage.multiSet([
      [RECOVERED_RESULT_KEY, JSON.stringify(recovered)],
    ]);
    await AsyncStorage.removeItem(PENDING_OPERATION_KEY);
    signalGpsDiscontinuity('android_recovery');
    DeviceEventEmitter.emit(RECOVERED_IMAGE_EVENT, recovered);
  } catch (error) {
    // Expo may return an error-shaped picker result. Preserve the operation so
    // the next foreground pass can retry recovery instead of losing the photo.
    if (__DEV__) console.warn('[ImagePicker] pending result recovery failed', error);
  }
}

export async function consumeRecoveredImagePickerResult(
  purpose: string,
): Promise<ImagePicker.ImagePickerResult | null> {
  const raw = await AsyncStorage.getItem(RECOVERED_RESULT_KEY);
  if (!raw) return null;
  try {
    const recovered = JSON.parse(raw) as RecoveredResult;
    if (recovered.purpose !== purpose) return null;
    await AsyncStorage.removeItem(RECOVERED_RESULT_KEY);
    return recovered.result;
  } catch {
    await AsyncStorage.removeItem(RECOVERED_RESULT_KEY);
    return null;
  }
}

export function useRecoveredImagePickerResult(
  purpose: string,
  onResult: (result: ImagePicker.ImagePickerResult) => void | Promise<void>,
) {
  const handlerRef = useRef(onResult);
  handlerRef.current = onResult;

  useEffect(() => {
    let mounted = true;
    const deliver = async () => {
      const result = await consumeRecoveredImagePickerResult(purpose);
      if (mounted && result) await handlerRef.current(result);
    };
    void deliver();
    const subscription = DeviceEventEmitter.addListener(
      RECOVERED_IMAGE_EVENT,
      (recovered: RecoveredResult) => {
        if (recovered?.purpose === purpose) void deliver();
      },
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, [purpose]);
}
