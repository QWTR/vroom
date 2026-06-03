import { DeviceEventEmitter } from 'react-native';

export const FRIEND_INVITE_HANDLED = 'vroom:friendInviteHandled';

export function emitFriendInviteHandled(friendshipId?: number) {
  DeviceEventEmitter.emit(FRIEND_INVITE_HANDLED, { friendshipId });
}
