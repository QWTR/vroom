import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { MyRoute } from '../../hooks/useMyRoutes';

vi.mock('react-native', async () => {
  const { createElement } = await import('react');
  const Container = ({ children }: any) => createElement('div', null, children);
  return {
    View: Container, TouchableOpacity: Container, Modal: Container,
    ActivityIndicator: Container, Alert: { alert: vi.fn() }, Share: { share: vi.fn() },
    Dimensions: { get: () => ({ width: 390 }) },
    FlatList: ({ data, renderItem }: any) => createElement('div', null,
      data.map((item: MyRoute) => createElement('div', { key: item.id }, renderItem({ item })))),
  };
});
vi.mock('../ui/AppText', () => ({ AppText: ({ children }: any) => React.createElement('span', null, children) }));
vi.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null, MaterialCommunityIcons: () => null, Feather: () => null }));
vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: {} }) }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('react-native-toast-message', () => ({ default: { show: vi.fn() } }));
vi.mock('react-native-svg', () => ({ default: 'svg', Polyline: 'polyline', Circle: 'circle', Defs: 'defs', LinearGradient: 'linearGradient', Stop: 'stop' }));

import RouteCard from './RouteCard';
import { RouteMiniMap } from './RouteMiniMap';
import { RoutesListModal } from '../modals/RoutesListModal';

const liteRoute: MyRoute = {
  id: 1, name: 'Wieczorna trasa', description: null, distance: 12.5,
  isPublic: false, isOffroad: false, createdAt: '2026-09-12', _count: { likes: 3 },
};
const noop = () => {};

describe('profile routes loaded without geometry', () => {
  it('renders the activity card without claiming an unknown point count is zero', () => {
    const html = renderToStaticMarkup(React.createElement(RouteCard, {
      route: liteRoute, isOwner: true, onDelete: noop, onNavigate: noop,
    }));
    expect(html).toContain('Wieczorna trasa');
    expect(html).toContain('12.5 km');
    expect(html).toContain('— pkt');
  });

  it('renders the full route list with the same lite response', () => {
    const html = renderToStaticMarkup(React.createElement(RoutesListModal, {
      visible: true, routes: [liteRoute], isOwner: true,
      onClose: noop, onNavigate: noop, onShare: noop, onDelete: noop, onLeaderboard: noop,
    }));
    expect(html).toContain('Wieczorna trasa');
    expect(html).toContain('— pkt');
  });

  it.each([undefined, null, []])('omits a minimap when geometry is unavailable: %s', points => {
    expect(renderToStaticMarkup(React.createElement(RouteMiniMap, { points }))).toBe('');
  });

  it('still draws the route when geometry is available', () => {
    const points = [{ latitude: 52.2, longitude: 21.0 }, { latitude: 52.3, longitude: 21.1 }];
    expect(renderToStaticMarkup(React.createElement(RouteMiniMap, { points }))).toContain('<polyline');
  });
});
