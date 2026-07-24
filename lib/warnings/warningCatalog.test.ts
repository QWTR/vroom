import { describe, expect, it } from 'vitest';
import { REPORTABLE_WARNING_TYPES, WARNING_CATALOG, warningSubtypeLabel } from './warningCatalog';

describe('warning v2 catalog', () => {
  it('keeps legacy kosmici display-only', () => {
    expect(WARNING_CATALOG.kosmici.reportable).toBe(false);
    expect(REPORTABLE_WARNING_TYPES).not.toContain('kosmici');
  });

  it('contains detailed police-control subtypes', () => {
    const values = WARNING_CATALOG.speed_control.subtypes.map((item) => item.value);
    expect(values).toEqual(expect.arrayContaining(['tachograph', 'truck_inspection', 'weighing', 'sobriety', 'unmarked_patrol']));
  });

  it('resolves a readable subtype label', () => {
    expect(warningSubtypeLabel('road_hazard', 'pothole')).toBe('Dziura');
  });
});
