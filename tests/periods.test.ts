import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addDays, weekStart, monthStart, monthEnd, addMonths, viewRange, stepDate, parseView,
  summarizeDays, periodStats, targetOn, dayStatus, progress, CLOSE_BAND_KCAL,
} from '../apps/web/lib/periods';

test('calendar helpers handle Monday-start weeks, month ends, leap years and year boundaries', () => {
  assert.equal(weekStart('2026-11-17'), '2026-11-16'); // Tuesday -> Monday
  assert.equal(weekStart('2026-11-16'), '2026-11-16'); // Monday stays
  assert.equal(weekStart('2026-11-22'), '2026-11-16'); // Sunday belongs to the same week
  assert.equal(weekStart('2027-01-01'), '2026-12-28');
  assert.equal(monthStart('2026-11-17'), '2026-11-01');
  assert.equal(monthEnd('2026-11-17'), '2026-11-30');
  assert.equal(monthEnd('2028-02-10'), '2028-02-29');
  assert.equal(monthEnd('2026-12-05'), '2026-12-31');
  assert.equal(addMonths('2026-12-31', 1), '2027-01-01');
  assert.equal(addMonths('2026-03-31', -1), '2026-02-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(parseView('week'), 'week');
  assert.equal(parseView('month'), 'month');
  for (const other of [undefined, 'day', 'year', ['week'], '<x>']) assert.equal(parseView(other), 'day');
});

test('view ranges: week is Mon-Sun, month grid is Monday-aligned and covers the whole month', () => {
  assert.deepEqual(viewRange('day', '2026-11-17'), { from: '2026-11-17', to: '2026-11-17', focusFrom: '2026-11-17', focusTo: '2026-11-17' });
  assert.deepEqual(viewRange('week', '2026-11-19'), { from: '2026-11-16', to: '2026-11-22', focusFrom: '2026-11-16', focusTo: '2026-11-22' });
  const month = viewRange('month', '2026-11-17');
  assert.deepEqual(month, { from: '2026-10-26', to: '2026-12-06', focusFrom: '2026-11-01', focusTo: '2026-11-30' });
  assert.equal(stepDate('day', '2026-11-17', -1), '2026-11-16');
  assert.equal(stepDate('week', '2026-11-19', 1), '2026-11-23');
  assert.equal(stepDate('month', '2026-11-17', -1), '2026-10-01');
});

test('targets apply from their effective date and statuses use the close band', () => {
  const targets = [
    { effective_from: '2026-11-17', calorie_target: 1900, protein_target_g: 160 },
    { effective_from: '2026-11-23', calorie_target: 2000, protein_target_g: 160 },
  ];
  assert.equal(targetOn(targets, '2026-11-16'), null);
  assert.equal(targetOn(targets, '2026-11-22')?.calorie_target, 1900);
  assert.equal(targetOn(targets, '2026-11-30')?.calorie_target, 2000);
  assert.equal(dayStatus(1900, 3, 1900, false), 'on');
  assert.equal(dayStatus(1900 + CLOSE_BAND_KCAL, 3, 1900, false), 'close');
  assert.equal(dayStatus(1900 + CLOSE_BAND_KCAL + 1, 3, 1900, false), 'over');
  assert.equal(dayStatus(0, 0, 1900, false), 'empty');
  assert.equal(dayStatus(500, 1, null, false), 'no-target');
  assert.equal(dayStatus(0, 0, 1900, true), 'future');
  assert.equal(progress(950, 1900), 0.5);
  assert.equal(progress(2500, 1900), 1);
  assert.equal(progress(10, null), null);
});

test('day summaries and period stats ignore unlogged and future days', () => {
  const days = summarizeDays({
    from: '2026-11-16', to: '2026-11-22', focusFrom: '2026-11-16', focusTo: '2026-11-22', today: '2026-11-19',
    foods: [
      { entry_date: '2026-11-17', calories: 996, protein_g: 41.2 },
      { entry_date: '2026-11-17', calories: 800, protein_g: 120 },
      { entry_date: '2026-11-18', calories: 2100, protein_g: 150 },
      { entry_date: '2026-11-19', calories: 1950, protein_g: 165 },
    ],
    exercises: [{ entry_date: '2026-11-18', duration_minutes: 60, calories_burned: 400 }, { entry_date: '2026-11-18', duration_minutes: null, calories_burned: null }],
    weights: [{ entry_date: '2026-11-17', weight_kg: 94.35 }, { entry_date: '2026-11-19', weight_kg: 93.9 }],
    targets: [{ effective_from: '2026-11-17', calorie_target: 1900, protein_target_g: 160 }],
  });
  assert.equal(days.length, 7);
  const byDate = Object.fromEntries(days.map(day => [day.date, day]));
  assert.equal(byDate['2026-11-16']!.status, 'empty'); // before targets and nothing logged
  assert.equal(byDate['2026-11-17']!.calories, 1796);
  assert.equal(byDate['2026-11-17']!.proteinG, 161.2);
  assert.equal(byDate['2026-11-17']!.status, 'on');
  assert.equal(byDate['2026-11-17']!.proteinHit, true);
  assert.equal(byDate['2026-11-18']!.status, 'over');
  assert.equal(byDate['2026-11-18']!.exerciseMinutes, 60);
  assert.equal(byDate['2026-11-18']!.exerciseCount, 2);
  assert.equal(byDate['2026-11-19']!.status, 'close');
  assert.equal(byDate['2026-11-20']!.status, 'future');
  assert.equal(byDate['2026-11-20']!.proteinHit, null);

  const stats = periodStats(days);
  assert.equal(stats.loggedDays, 3);
  assert.equal(stats.avgCalories, (1796 + 2100 + 1950) / 3);
  assert.equal(stats.totalDeficit, (1900 - 1796) + (1900 - 2100) + (1900 - 1950));
  assert.equal(stats.daysOnTarget, 1);
  assert.equal(stats.proteinDaysHit, 2);
  assert.equal(stats.exerciseMinutes, 60);
  assert.equal(stats.weightChangeKg, -0.45);
});

test('period stats exclude out-of-focus grid padding days and handle empty periods', () => {
  const days = summarizeDays({
    from: '2026-10-26', to: '2026-12-06', focusFrom: '2026-11-01', focusTo: '2026-11-30', today: '2026-12-31',
    foods: [{ entry_date: '2026-10-30', calories: 3000, protein_g: 10 }],
    exercises: [], weights: [], targets: [],
  });
  assert.equal(days.length, 42);
  assert.equal(days.filter(day => day.inFocus).length, 30);
  const stats = periodStats(days);
  assert.equal(stats.loggedDays, 0);
  assert.equal(stats.avgCalories, null);
  assert.equal(stats.totalDeficit, null);
  assert.equal(stats.weightChangeKg, null);
});
