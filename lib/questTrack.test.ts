import { describe, expect, it } from 'vitest';
import {
  formatQuestProgress,
  sortQuestTasks,
} from './questTrackUtils';
import type { QuestTask } from './questTrack';

const task = (input: Partial<QuestTask>): QuestTask => ({
  key: input.key ?? 'task',
  label: input.label ?? 'Zadanie',
  kind: input.kind ?? 'rides',
  current: input.current ?? 0,
  target: input.target ?? 5,
  unit: input.unit ?? 'przejazdów',
  progress: input.progress ?? 0,
  points: input.points ?? 10,
  done: input.done ?? false,
  earned: input.earned ?? 0,
  completedAt: input.completedAt ?? null,
});

describe('quest track presentation', () => {
  it('puts closest unfinished tasks first and completed tasks last', () => {
    const result = sortQuestTasks([
      task({ key: 'done-old', done: true, completedAt: '2026-07-28T08:00:00Z' }),
      task({ key: 'near', progress: 0.8 }),
      task({ key: 'far', progress: 0.2 }),
      task({ key: 'done-new', done: true, completedAt: '2026-07-29T08:00:00Z' }),
    ]);
    expect(result.map((item) => item.key)).toEqual(['near', 'far', 'done-new', 'done-old']);
  });

  it('formats numeric progress with local units', () => {
    expect(formatQuestProgress(task({
      kind: 'km',
      current: 37.24,
      target: 80,
      unit: 'km',
    }))).toBe('37.2/80 km');
    expect(formatQuestProgress(task({ current: 2, target: 5 }))).toBe('2/5 przejazdów');
  });
});
