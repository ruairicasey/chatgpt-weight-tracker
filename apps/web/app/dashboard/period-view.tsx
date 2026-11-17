import Link from 'next/link';
import type { DaySummary, PeriodStats } from '../../lib/periods';
import { href, kcal, grams, shortDate, ProgressBar } from './components';

const STATUS_LABEL: Record<DaySummary['status'], string> = {
  on: 'On target', close: 'Slightly over', over: 'Over target', empty: 'Nothing logged',
  'no-target': 'No target set', future: 'Upcoming',
};

function signed(value: number, digits = 0) {
  const fixed = Math.abs(value).toFixed(digits);
  return value > 0 ? `+${fixed}` : value < 0 ? `−${fixed}` : fixed;
}

export function PeriodStatsBar({ stats, days }: { stats: PeriodStats; days: number }) {
  const deficit = stats.totalDeficit;
  return <div className="period-stats">
    <div className="metric"><span>Avg calories</span><strong>{stats.avgCalories !== null ? kcal(stats.avgCalories) : '—'}</strong>
      <small>{stats.loggedDays} of {days} days logged</small></div>
    <div className="metric"><span>Avg protein</span><strong>{stats.avgProteinG !== null ? grams(stats.avgProteinG) : '—'}</strong>
      <small>Target hit {stats.proteinDaysHit} of {stats.loggedDays} days</small></div>
    <div className="metric"><span>{deficit !== null && deficit < 0 ? 'Total surplus vs target' : 'Total deficit vs target'}</span>
      <strong>{deficit !== null ? kcal(Math.abs(deficit)) : '—'}</strong>
      <small>{stats.daysOnTarget} days on target</small></div>
    <div className="metric"><span>Weight change</span><strong>{stats.weightChangeKg !== null ? `${signed(stats.weightChangeKg, 2)} kg` : '—'}</strong>
      <small>{stats.weightChangeKg === null ? 'Needs 2+ weigh-ins' : 'First to last weigh-in'}{stats.exerciseMinutes ? ` · ${stats.exerciseMinutes} min exercise` : ''}</small></div>
  </div>;
}

export function DayCard({ day, compact, today }: { day: DaySummary; compact: boolean; today: string }) {
  const classes = ['day-card', `status-${day.status}`, day.inFocus ? '' : 'out-of-focus', day.date === today ? 'is-today' : '', compact ? 'compact' : ''].filter(Boolean).join(' ');
  const title = `${shortDate(day.date, { weekday: 'long', day: 'numeric', month: 'long' })}: ${STATUS_LABEL[day.status]}`;
  return <Link className={classes} href={href('day', day.date)} title={title} aria-label={title}>
    <span className="day-card-date">
      {compact ? shortDate(day.date, { day: 'numeric' }) : shortDate(day.date, { weekday: 'short', day: 'numeric', month: 'short' })}
    </span>
    {day.foodCount > 0 ? <>
      <strong className="day-card-kcal">{Math.round(day.calories).toLocaleString('en-AU')}{!compact && day.calorieTarget !== null && <small> / {day.calorieTarget.toLocaleString('en-AU')}</small>}</strong>
      {!compact && <ProgressBar consumed={day.calories} target={day.calorieTarget} label="Calories against target" />}
      {!compact && <span className={`day-card-protein ${day.proteinHit ? 'hit' : 'miss'}`}>{grams(day.proteinG)} protein{day.proteinHit ? ' ✓' : ''}</span>}
    </> : <span className="day-card-empty">{day.status === 'future' ? '' : '—'}</span>}
    {!compact && <span className="day-card-extra">
      {day.weightKg !== null && <span>{day.weightKg.toFixed(1)} kg</span>}
      {day.exerciseMinutes > 0 && <span>{day.exerciseMinutes} min</span>}
    </span>}
    {compact && (day.weightKg !== null || day.exerciseCount > 0) && <span className="day-card-dots" aria-hidden="true">
      {day.weightKg !== null && <i className="dot-weight" />}{day.exerciseCount > 0 && <i className="dot-exercise" />}
    </span>}
  </Link>;
}

export function Legend() {
  return <p className="status-legend">
    <span className="status-on">On target</span><span className="status-close">Within 100 kcal over</span>
    <span className="status-over">Over</span><span className="status-empty">Not logged</span>
  </p>;
}

export function WeekGrid({ days, today }: { days: readonly DaySummary[]; today: string }) {
  return <div className="week-grid">{days.map(day => <DayCard key={day.date} day={day} compact={false} today={today} />)}</div>;
}

export function MonthGrid({ days, today }: { days: readonly DaySummary[]; today: string }) {
  return <div className="month-grid">
    {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(name => <span key={name} className="month-weekday">{name}</span>)}
    {days.map(day => <DayCard key={day.date} day={day} compact={true} today={today} />)}
    <p className="month-key"><i className="dot-weight" /> weigh-in <i className="dot-exercise" /> exercise · tap a day for details</p>
  </div>;
}
