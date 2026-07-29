import type { QuestTask } from './questTrack';

export function sortQuestTasks(tasks: QuestTask[]): QuestTask[] {
  return [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (!a.done) {
      if (b.progress !== a.progress) return b.progress - a.progress;
      return a.label.localeCompare(b.label, 'pl');
    }
    const aCompleted = a.completedAt ? Date.parse(a.completedAt) : 0;
    const bCompleted = b.completedAt ? Date.parse(b.completedAt) : 0;
    return bCompleted - aCompleted;
  });
}

export function formatQuestProgress(task: QuestTask): string {
  const current = task.kind === 'km'
    ? Number(task.current.toFixed(1))
    : Math.floor(task.current);
  const target = task.kind === 'km'
    ? Number(task.target.toFixed(1))
    : Math.floor(task.target);
  return task.unit ? `${current}/${target} ${task.unit}` : `${current}/${target}`;
}
