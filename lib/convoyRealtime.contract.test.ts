import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const convoyScreen = readFileSync(resolve(process.cwd(), 'app/convoy.tsx'), 'utf8');
const convoyHook = readFileSync(resolve(process.cwd(), 'hooks/useActiveConvoyMap.ts'), 'utf8');
const noticeOverlay = readFileSync(resolve(process.cwd(), 'components/map/ConvoyNoticeOverlay.tsx'), 'utf8');

describe('convoy realtime integration contract', () => {
  it('rejoins the convoy room after reconnect and confirms status delivery', () => {
    expect(convoyScreen).toContain('joinSharedRoom(');
    expect(convoyHook).toContain('joinSharedRoom(');
    expect(convoyScreen).toContain("'convoy:unsubscribe'");
    expect(convoyScreen).toContain("emitWithAck('convoy:join'");
    expect(convoyScreen).toContain("emitWithAck('convoy:status'");
  });

  it('uses the remotely managed convoy sound with a bundled fallback', () => {
    expect(noticeOverlay).toContain("playRadioCue('convoyNotification'");
    expect(noticeOverlay).toContain('convoy-notify.wav');
  });
});
