import Link from 'next/link';
import type { DashboardView } from '../../lib/periods';
import { progress } from '../../lib/periods';

export function href(view: DashboardView, date: string, extra: Record<string, string> = {}) {
  const params = new URLSearchParams({ view, date, ...extra });
  return `/dashboard?${params.toString()}`;
}

export function ViewTabs({ view, date }: { view: DashboardView; date: string }) {
  const tabs: Array<[DashboardView, string]> = [['day', 'Day'], ['week', 'Week'], ['month', 'Month']];
  return <div className="view-tabs" role="tablist" aria-label="Dashboard view">
    {tabs.map(([key, label]) => <Link key={key} role="tab" aria-selected={view === key} aria-current={view === key ? 'page' : undefined}
      className={view === key ? 'active' : undefined} href={href(key, date)}>{label}</Link>)}
  </div>;
}

export function PeriodNav({ view, label, prev, next, today, date }: {
  view: DashboardView; label: string; prev: string; next: string; today: string; date: string;
}) {
  return <div className="period-nav">
    <Link className="nav-arrow" href={href(view, prev)} aria-label={`Previous ${view}`}>←</Link>
    <strong className="period-label">{label}</strong>
    <Link className="nav-arrow" href={href(view, next)} aria-label={`Next ${view}`}>→</Link>
    {date !== today && <Link className="today-link" href={href(view, today)}>Today</Link>}
    <form method="get" action="/dashboard" className="date-form">
      <input type="hidden" name="view" value={view} />
      <label htmlFor="day" className="visually-hidden">Go to date</label>
      <input id="day" name="date" type="date" defaultValue={date} required />
      <button type="submit">Go</button>
    </form>
  </div>;
}

export function ProgressBar({ consumed, target, label }: { consumed: number; target: number | null; label: string }) {
  const ratio = progress(consumed, target);
  if (ratio === null) return null;
  const over = target !== null && consumed > target;
  return <div className={`bar ${over ? 'bar-over' : 'bar-under'}`} role="progressbar" aria-label={label}
    aria-valuemin={0} aria-valuemax={target ?? 0} aria-valuenow={Math.round(consumed)}>
    <span style={{ width: `${(ratio * 100).toFixed(1)}%` }} />
  </div>;
}

export const kcal = (value: number) => `${Math.round(value).toLocaleString('en-AU')} kcal`;
export const grams = (value: number) => `${value.toFixed(1)} g`;

export function shortDate(day: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', ...options }).format(new Date(`${day}T00:00:00Z`));
}
