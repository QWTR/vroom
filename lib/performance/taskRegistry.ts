export type ManagedTaskPolicy = 'activeOnly' | 'foreground' | 'tripOnly' | 'appGlobal';

const activeTasks = new Set<string>();
let duplicateStarts = 0;
let hiddenViolations = 0;

export function acquireManagedTask(id: string): boolean {
  if (activeTasks.has(id)) {
    duplicateStarts += 1;
    return false;
  }
  activeTasks.add(id);
  return true;
}

export function releaseManagedTask(id: string): void {
  activeTasks.delete(id);
}

export function noteHiddenTaskViolation(): void {
  hiddenViolations += 1;
}

export function managedTaskStats(): { active: number; duplicateStarts: number; hiddenViolations: number } {
  return { active: activeTasks.size, duplicateStarts, hiddenViolations };
}

export function resetManagedTaskRegistryForTests(): void {
  activeTasks.clear();
  duplicateStarts = 0;
  hiddenViolations = 0;
}

export function shouldRunManagedTask(input: {
  policy: ManagedTaskPolicy;
  sceneActive: boolean;
  appActive: boolean;
  tripActive: boolean;
}): boolean {
  if (input.policy === 'appGlobal') return true;
  if (input.policy === 'tripOnly') return input.tripActive;
  if (input.policy === 'foreground') return input.appActive;
  return input.appActive && input.sceneActive;
}
