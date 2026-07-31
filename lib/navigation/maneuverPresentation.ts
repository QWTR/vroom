export function navigationNotificationIcon(maneuver?: string): string {
  switch (maneuver) {
    case 'turn-left': return '⬅️';
    case 'turn-right': return '➡️';
    case 'turn-slight-left': return '↖️';
    case 'turn-slight-right': return '↗️';
    case 'turn-sharp-left': return '↩️';
    case 'turn-sharp-right': return '↪️';
    case 'uturn-left':
    case 'uturn-right': return '🔄';
    case 'roundabout-left':
    case 'roundabout-right': return '🔃';
    case 'ramp-left':
    case 'ramp-right': return '🛣️';
    case 'merge':
    case 'merge-left':
    case 'merge-right': return '🔀';
    case 'fork-left':
    case 'fork-right': return '⑂';
    case 'ferry': return '⛴️';
    case 'straight': return '⬆️';
    default: return '🧭';
  }
}
