import { describe, expect, it } from 'vitest';
import { isSafeInternalNotificationUrl, resolveNotificationUrl } from './routingCore';

describe('notification routing', () => {
  it.each([
    ['new_message', { conversationId: 2, messageId: 9 }, '/Community/chats/2?messageId=9'],
    ['market_message', { conversationId: 3, messageId: 8 }, '/Community/market/chat/3?messageId=8'],
    ['comment_reply', { postId: 4, commentId: 7 }, '/Community/community/community?postId=4&commentId=7'],
    ['like_vroomki_comment', { vroomkiPostId: 5, commentId: 6 }, '/Community/vroomki?vroomkiId=5&commentId=6'],
    ['comment_spot', { spotId: 10 }, '/(tabs)/spotmap?spotId=10'],
    ['comment_car', { carId: 11 }, '/profile/car-detail?id=11'],
    ['club_chat', { clubId: 12, channelId: 13, messageId: 14 }, '/Community/clubs/12?channelId=13&messageId=14'],
    ['mention_public_chat', { messageId: 15 }, '/Community/public/public?messageId=15'],
    ['meet_participant_applied', { meetId: 16 }, '/Community/meets/applications?id=16'],
    ['meet_reminder', { meetId: 17 }, '/Community/meets/meet?id=17'],
    ['geo_drop_available', { dropId: 18, lat: 52.1, lng: 21.1 }, '/(tabs)/map?dropId=18&lat=52.1&lng=21.1'],
    ['daily_duel_available', {}, '/Community/duel/vote'],
    ['achievement', { achievementKey: 'first_drive' }, '/profile/achievements?achievementKey=first_drive'],
    ['bug_report_reply', { bugReportId: 19 }, '/profile/bug-report/19'],
    ['market_purchase', { orderId: 'ord_20' }, '/Community/market/orders?orderId=ord_20'],
    ['vehicle_order_ready', { orderId: 21 }, '/shop/vehicle-order/21'],
    ['streak_at_risk', {}, '/(tabs)/map?start=freeDrive'],
    ['grid_vote_ending', { eventId: 22, battleId: 23 }, '/Community/grid/vote?eventId=22&battleId=23'],
    ['partner_event_update', { eventId: 24 }, '/partner/events/24'],
  ])('%s opens its precise destination', (type, data, expected) => {
    expect(resolveNotificationUrl({ type, ...data })).toBe(expected);
  });

  it('prefers a valid V1 URL and rejects external injection', () => {
    expect(resolveNotificationUrl({ v: 1, type: 'achievement', url: '/profile/achievements?achievementKey=x' })).toBe('/profile/achievements?achievementKey=x');
    expect(isSafeInternalNotificationUrl('https://evil.example')).toBe(false);
    expect(resolveNotificationUrl({ type: 'unknown', url: '//evil.example' })).toBe('/notifications');
  });
});
