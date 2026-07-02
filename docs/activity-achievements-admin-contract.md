# Activity, Achievements and Admin Contract

## Activity Sessions

Final ride history entries must be created only by final session saves.

`POST /api/activity/save`

Required final-session fields:
- `tripSessionId: string`
- `source: "drive_final" | "navigation_final"`
- `distance: number`
- `maxSpeed: number`
- `avgSpeed: number`
- `duration: number | null`
- `routePoints: { latitude: number; longitude: number }[]`
- `routePointsCount: number`
- `startedAt: string`
- `endedAt: string`

Checkpoint/progress updates must not create ride-history rows.

`POST /api/activity/session/checkpoint`

Checkpoint fields:
- `tripSessionId: string`
- `distance: number`
- `maxSpeed: number`
- `avgSpeed: number`
- `source: "trip-checkpoint" | "background-passive" | "driving" | "navigation"`
- `visibleInHistory: false`

## History Filtering

`GET /api/activity/history` should return only visible final ride sessions.

Backend migration:
- Set `visibleInHistory=false` for `source="trip-checkpoint"` and `source="background-passive"`.
- Set `visibleInHistory=false` for historical rows without at least two route points, unless explicitly marked as final.
- Keep their distance contribution in aggregate profile stats.

## Achievement Metrics

`POST /api/achievements/check` should support these condition fields:
- `totalDistance`
- `totalRides`
- `longestRide`
- `topSpeed`
- `rideStreakDays`
- `geoDropsClaimed`
- `rareDropsClaimed`
- `epicDropsClaimed`
- `legendaryDropsClaimed`
- `spotsCreated`
- `spotPhotosUploaded`
- `followersCount`

Admin achievement CRUD must expose:
- `key`
- `label`
- `description`
- `icon`
- `category`
- `rarity`
- `points`
- `conditionField`
- `conditionValue`
- `active`
- `sortOrder`

Admin should also show unlock count and in-progress percentage for every achievement.
