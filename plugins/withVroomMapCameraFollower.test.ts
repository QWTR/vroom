import { describe, expect, it } from 'vitest';

const plugin = require('./withVroomMapCameraFollower');
const { resolveIosProjectName } = plugin.__internal;

describe('Vroom iOS map camera follower plugin', () => {
  it('resolves a fresh prebuild from Expo config before AppDelegate exists', () => {
    expect(resolveIosProjectName({
      name: 'Vroom App',
      modRequest: { platformProjectRoot: 'C:/missing/ios' },
    })).toBe('VroomApp');
  });

  it('keeps its Swift sources beside the plugin for EAS uploads', () => {
    const fs = require('fs');
    const path = require('path');
    expect(fs.existsSync(path.join(__dirname, 'map-camera-follower', 'ios', 'VroomMapCameraFollower.swift'))).toBe(true);
    expect(fs.existsSync(path.join(__dirname, 'map-camera-follower', 'ios', 'VroomMapCameraFollowerBridge.m'))).toBe(true);
  });
});
