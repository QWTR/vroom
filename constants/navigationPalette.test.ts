import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NAVIGATION_ROUTE_PALETTE } from './navigationPalette';

const root = path.resolve(__dirname, '..');

describe('navigation route palette contract', () => {
  it('keeps phone, Android Auto and CarPlay colors aligned', () => {
    expect(NAVIGATION_ROUTE_PALETTE).toEqual({
      dayCore: '#8438F5',
      nightCore: '#D06BFF',
      casing: '#100816',
      nightGlow: '#D06BFF47',
      alternative: '#8F96A3',
    });

    const android = fs.readFileSync(
      path.join(root, 'native/android-auto/VroomMapSurfaceRenderer.kt'),
      'utf8',
    );
    const carPlay = fs.readFileSync(
      path.join(root, 'modules/vroom-carplay/ios/VroomCarPlayMapViewController.swift'),
      'utf8',
    );

    expect(android).toContain('Color.rgb(132, 56, 245)');
    expect(android).toContain('Color.rgb(208, 107, 255)');
    expect(android).toContain('Color.rgb(16, 8, 22)');
    expect(carPlay).toContain('red: 132 / 255, green: 56 / 255, blue: 245 / 255');
    expect(carPlay).toContain('red: 208 / 255, green: 107 / 255, blue: 1');
    expect(carPlay).toContain('red: 16 / 255, green: 8 / 255, blue: 22 / 255');
  });
});
