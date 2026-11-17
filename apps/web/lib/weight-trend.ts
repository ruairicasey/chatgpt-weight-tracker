export type TrendWeight = { entry_date: string; weight_kg: number };

function dayIndex(day: string) {
  return Date.parse(`${day}T00:00:00Z`) / 86_400_000;
}

export function weightTrend<T extends TrendWeight>(rows: readonly T[], today: string) {
  const sorted = [...rows].sort((a,b) => a.entry_date.localeCompare(b.entry_date));
  const points = sorted.map(row => {
    const day = dayIndex(row.entry_date);
    const inWindow = sorted.filter(other => {
      const distance = day - dayIndex(other.entry_date);
      return distance >= 0 && distance < 7;
    });
    return { date: row.entry_date, weightKg: Number(row.weight_kg),
      rolling7Kg: inWindow.reduce((sum, r) => sum + Number(r.weight_kg), 0) / inWindow.length };
  });
  const todayNumber = dayIndex(today);
  const last14 = sorted.filter(row => {
    const distance = todayNumber - dayIndex(row.entry_date);
    return distance >= 0 && distance < 14;
  });
  let weeklyChange: null | { kg: number; percent: number; spanDays: number } = null;
  if (last14.length >= 2) {
    const first = last14[0]!;
    const last = last14[last14.length - 1]!;
    const spanDays = dayIndex(last.entry_date) - dayIndex(first.entry_date);
    if (spanDays > 0) {
      const kg = (Number(last.weight_kg) - Number(first.weight_kg)) * 7 / spanDays;
      weeklyChange = { kg, percent: kg / Number(first.weight_kg) * 100, spanDays };
    }
  }
  return { points, weeklyChange };
}

export function trendSvg(points: readonly { date: string; weightKg: number; rolling7Kg: number }[]) {
  if (!points.length) return null;
  const allValues = points.flatMap(p => [p.weightKg, p.rolling7Kg]);
  const minimum = Math.min(...allValues), maximum = Math.max(...allValues);
  const range = Math.max(maximum - minimum, 0.5);
  const minDate = dayIndex(points[0]!.date), maxDate = dayIndex(points[points.length - 1]!.date);
  const x = (date: string) => 24 + (dayIndex(date) - minDate) / Math.max(maxDate - minDate, 1) * 752;
  const y = (weight: number) => 210 - (weight - minimum) / range * 180;
  const path = (get: (p: typeof points[number]) => number) =>
    points.map((p,i) => `${i === 0 ? 'M' : 'L'}${x(p.date).toFixed(1)},${y(get(p)).toFixed(1)}`).join(' ');
  return { actual: path(p=>p.weightKg), average: path(p=>p.rolling7Kg),
    dots: points.map(p=>({ x: x(p.date), y: y(p.weightKg), date: p.date, weightKg: p.weightKg })),
    min: minimum, max: maximum };
}
