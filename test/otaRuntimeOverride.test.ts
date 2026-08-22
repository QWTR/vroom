import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function readRuntime(runtime?: string): string {
  const output = execFileSync(
    process.execPath,
    ['node_modules/expo/bin/cli', 'config', '--type', 'public', '--json'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, VROOM_OTA_RUNTIME_VERSION: runtime ?? '' },
    },
  );
  return JSON.parse(output).runtimeVersion;
}

describe('OTA runtime override', () => {
  it('uses the native build runtime by default', () => {
    expect(readRuntime()).toBe('1.0.29');
  });

  it('can target the installed 1.0.28 binary explicitly', () => {
    expect(readRuntime('1.0.28')).toBe('1.0.28');
  });
});
