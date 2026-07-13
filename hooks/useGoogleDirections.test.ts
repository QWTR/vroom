import { describe, expect, it } from 'vitest';
import {
  directionsErrorFromProxyFailure,
  isTransientDirectionsFailure,
} from './useGoogleDirections';

describe('directions proxy error policy', () => {
  it('reserves NO_ROUTE for a confirmed empty routes response', () => {
    expect(directionsErrorFromProxyFailure('auth')).toBe('AUTH');
    expect(directionsErrorFromProxyFailure('timeout')).toBe('NETWORK');
    expect(directionsErrorFromProxyFailure('network')).toBe('NETWORK');
    expect(directionsErrorFromProxyFailure('server')).toBe('SERVER');
    expect(directionsErrorFromProxyFailure('http')).toBe('INVALID_RESPONSE');
    expect(directionsErrorFromProxyFailure('invalid_response')).toBe('INVALID_RESPONSE');
  });

  it('retries only transport failures that can recover', () => {
    expect(isTransientDirectionsFailure('network')).toBe(true);
    expect(isTransientDirectionsFailure('timeout')).toBe(true);
    expect(isTransientDirectionsFailure('server')).toBe(true);
    expect(isTransientDirectionsFailure('auth')).toBe(false);
    expect(isTransientDirectionsFailure('http')).toBe(false);
  });
});
