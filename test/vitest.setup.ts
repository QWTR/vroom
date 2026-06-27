import { vi } from 'vitest';

vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (o: Record<string, unknown>) => o.ios ?? o.default },
}));

vi.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///tmp/cache/',
  documentDirectory: 'file:///tmp/',
  EncodingType: { UTF8: 'utf8' },
  getInfoAsync: vi.fn(() => Promise.resolve({ exists: false })),
  makeDirectoryAsync: vi.fn(() => Promise.resolve()),
  downloadAsync: vi.fn((url: string, to: string) => Promise.resolve({ uri: to, status: 200 })),
  writeAsStringAsync: vi.fn(() => Promise.resolve()),
  readAsStringAsync: vi.fn(() => Promise.resolve('')),
}));
