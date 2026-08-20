import { describe, expect, it } from 'vitest';
import {
  buildDraftStructure,
  getMemberRanks,
  groupChannelsByCategory,
  hasClubPermission,
  moveDraftItem,
  slugifyChannelName,
} from '../components/clubs/clubManagementModel';

describe('club management model', () => {
  it('normalizes channel names like a Discord-style text channel', () => {
    expect(slugifyChannelName('  Ważne Ogłoszenia!!!  ')).toBe('wazne-ogloszenia');
    expect(slugifyChannelName('🚗 Spoty___Śląsk')).toBe('spoty___slask');
  });

  it('builds and groups a stable ordered channel draft', () => {
    const draft = buildDraftStructure({
      categories: [
        { id: 2, name: 'Ekipa', position: 1 },
        { id: 1, name: 'Start', position: 0 },
      ],
      channels: [
        { id: 3, name: 'auta', categoryId: 2, position: 2 },
        { id: 1, name: 'powitania', categoryId: 1, position: 0 },
        { id: 2, name: 'ogolny', categoryId: 1, position: 1 },
      ],
    });
    expect(draft.categories.map((category) => category.name)).toEqual(['Start', 'Ekipa']);
    expect(groupChannelsByCategory(draft.categories, draft.channels).map((section) => [
      section.name,
      section.channels.map((channel) => channel.name),
    ])).toEqual([
      ['Start', ['powitania', 'ogolny']],
      ['Ekipa', ['auta']],
    ]);
  });

  it('reorders items and recalculates positions', () => {
    const items = [{ id: 1, position: 0 }, { id: 2, position: 1 }, { id: 3, position: 2 }];
    expect(moveDraftItem(items, 2, -1)).toEqual([
      { id: 1, position: 0 },
      { id: 3, position: 1 },
      { id: 2, position: 2 },
    ]);
    expect(moveDraftItem(items, 0, -1)).toBe(items);
  });

  it('combines multiple ranks for permissions and sorts member roles by priority', () => {
    const ranks = [
      { id: 1, name: 'Helper', color: '#fff', priority: 1, canKick: false, canMute: true, canPin: false, canManage: false },
      { id: 2, name: 'Admin', color: '#f00', priority: 10, canKick: true, canMute: false, canPin: true, canManage: true },
    ];
    expect(hasClubPermission({ myRole: 'ranked', myRanks: ranks, myRank: ranks[1] }, 'canKick')).toBe(true);
    expect(getMemberRanks({ ranks, rank: ranks[0] }).map((rank) => rank.name)).toEqual(['Admin', 'Helper']);
  });
});
