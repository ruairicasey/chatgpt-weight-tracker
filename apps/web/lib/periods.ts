/** Pure calendar and summary helpers for the day/week/month dashboard views. */

export type DashboardView = 'day' | 'week' | 'month';
export type DayStatus = 'on' | 'close' | 'over' | 'empty' | 'no-target' | 'future';

/** Within this many kcal over target a day is "close" rather than "over". */
export const CLOSE_BAND_KCAL = 100;

const DAY_MS = 86_400_000;
const toDate = (day: string) => new Date(`${day}T00:00:00Z`);
const fromDate = (date: Date) => date.toISOString().slice(0, 10);

export function addDays(day: string, days: number): string {
  return fromDate(new Date(toDate(day).getTime() + days * DAY_MS));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / DAY_MS);
}

/** Monday of the ISO week containing the day. */
export function weekStart(day: string): string {
  const weekday = (toDate(day).getUTCDay() + 6) % 7; // Monday = 0
  return addDays(day, -weekday);
}

export function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

export function monthEnd(day: string): string {
  const date = toDate(monthStart(day));
  date.setUTCMonth(date.getUTCMonth() + 1);
  return addDays(fromDate(date), -1);
}

export function addMonths(day: string, months: number): string {
  const date = toDate(monthStart(day));
  date.setUTCMonth(date.getUTCMonth() + months);
  return fromDate(date);
}

export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) out.push(day);
  return out;
}

export function parseView(value: unknown): DashboardView {
  return value === 'week' || value === 'month' ? value : 'day';
}

/** The visible date span for a view: one day, Monday–Sunday, or a Monday-aligned month grid. */
export function viewRange(view: DashboardView, day: string) {
  if (view === 'day') return { from: day, to: day, focusFrom: day, focusTo: day };
  if (view === 'week') { const from = weekStart(day); return { from, to: addDays(from, 6), focusFrom: from, focusTo: addDays(from, 6) }; }
  const first = monthStart(day), last = monthEnd(day);
  return { from: weekStart(first), to: addDays(weekStart(last), 6), focusFrom: first, focusTo: last };
}

/** The date to navigate to for previous/next in a view. */
export function stepDate(view: DashboardView, day: string, direction: -1 | 1): string {
  if (view === 'day') return addDays(day, direction);
  if (view === 'week') return addDays(weekStart(day), 7 * direction);
  return addMonths(day, direction);
}

export type FoodLike = { entry_date: string; calories: number; protein_g: number };
export type ExerciseLike = { entry_date: string; duration_minutes: number | null; calories_burned: number | null };
export type WeightLike = { entry_date: string; weight_kg: number };
export type TargetLike = { effective_from: string; calorie_target: number; protein_target_g: number };

export type DaySummary = {
  date: string;
  inFocus: boolean;
  calories: number;
  proteinG: number;
  foodCount: number;
  exerciseMinutes: number;
  exerciseCount: number;
  weightKg: number | null;
  calorieTarget: number | null;
  proteinTargetG: number | null;
  status: DayStatus;
  proteinHit: boolean | null;
};

/** Target effective on a date: the latest row with effective_from <= date. */
export function targetOn<T extends TargetLike>(targets: readonly T[], day: string): T | null {
  let best: T | null = null;
  for (const target of targets) {
    if (target.effective_from <= day && (!best || target.effective_from > best.effective_from)) best = target;
  }
  return best;
}

export function dayStatus(calories: number, foodCount: number, target: number | null, isFuture: boolean): DayStatus {
  if (isFuture) return 'future';
  if (foodCount === 0) return 'empty';
  if (target === null) return 'no-target';
  if (calories <= target) return 'on';
  if (calories <= target + CLOSE_BAND_KCAL) return 'close';
  return 'over';
}

export function summarizeDays(input: {
  from: string; to: string; focusFrom: string; focusTo: string; today: string;
  foods: readonly FoodLike[]; exercises: readonly ExerciseLike[];
  weights: readonly WeightLike[]; targets: readonly TargetLike[];
}): DaySummary[] {
  return dateRange(input.from, input.to).map(date => {
    const foods = input.foods.filter(row => row.entry_date === date);
    const exercises = input.exercises.filter(row => row.entry_date === date);
    const weight = input.weights.find(row => row.entry_date === date);
    const target = targetOn(input.targets, date);
    const calories = foods.reduce((sum, row) => sum + Number(row.calories), 0);
    const proteinG = Number(foods.reduce((sum, row) => sum + Number(row.protein_g), 0).toFixed(2));
    const calorieTarget = target ? Number(target.calorie_target) : null;
    const proteinTargetG = target ? Number(target.protein_target_g) : null;
    const isFuture = date > input.today;
    return {
      date, inFocus: date >= input.focusFrom && date <= input.focusTo,
      calories, proteinG, foodCount: foods.length,
      exerciseMinutes: exercises.reduce((sum, row) => sum + Number(row.duration_minutes ?? 0), 0),
      exerciseCount: exercises.length,
      weightKg: weight ? Number(weight.weight_kg) : null,
      calorieTarget, proteinTargetG,
      status: dayStatus(calories, foods.length, calorieTarget, isFuture),
      proteinHit: !isFuture && foods.length > 0 && proteinTargetG !== null ? proteinG >= proteinTargetG : null,
    };
  });
}

export type PeriodStats = {
  loggedDays: number;
  avgCalories: number | null;
  avgProteinG: number | null;
  /** Sum of (target - calories) over logged days with a target; positive = under target. */
  totalDeficit: number | null;
  daysOnTarget: number;
  proteinDaysHit: number;
  exerciseMinutes: number;
  /** Last minus first weigh-in inside the period; null with fewer than two weigh-ins. */
  weightChangeKg: number | null;
};

/** Stats over in-focus, non-future days. Days without food are excluded from averages. */
export function periodStats(days: readonly DaySummary[]): PeriodStats {
  const focus = days.filter(day => day.inFocus && day.status !== 'future');
  const logged = focus.filter(day => day.foodCount > 0);
  const withTarget = logged.filter(day => day.calorieTarget !== null);
  const weighIns = focus.filter(day => day.weightKg !== null);
  const avg = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  return {
    loggedDays: logged.length,
    avgCalories: avg(logged.map(day => day.calories)),
    avgProteinG: avg(logged.map(day => day.proteinG)),
    totalDeficit: withTarget.length ? withTarget.reduce((sum, day) => sum + (day.calorieTarget! - day.calories), 0) : null,
    daysOnTarget: logged.filter(day => day.status === 'on').length,
    proteinDaysHit: logged.filter(day => day.proteinHit).length,
    exerciseMinutes: focus.reduce((sum, day) => sum + day.exerciseMinutes, 0),
    weightChangeKg: weighIns.length >= 2 ? Number((weighIns[weighIns.length - 1]!.weightKg! - weighIns[0]!.weightKg!).toFixed(2)) : null,
  };
}

/** Progress for a bar, clamped to [0, 1]; null when there is no target. */
export function progress(consumed: number, target: number | null): number | null {
  if (target === null || target <= 0) return null;
  return Math.max(0, Math.min(1, consumed / target));
}
