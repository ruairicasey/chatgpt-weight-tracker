import Link from 'next/link';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readDashboard, readRange } from '../../lib/dashboard-data';
import { weightTrend, trendSvg } from '../../lib/weight-trend';
import { viewRange, stepDate, summarizeDays, periodStats, weekStart, addDays, type DashboardView } from '../../lib/periods';
import { PeriodNav, ProgressBar, href, kcal, grams, shortDate } from './components';
import { PeriodStatsBar, WeekGrid, MonthGrid, Legend } from './period-view';

const HISTORY_ROWS = 14;
type Client = SupabaseClient;

export async function PeriodView({ supabase, view, date, today }: { supabase: Client; view: Exclude<DashboardView, 'day'>; date: string; today: string }) {
  const range = viewRange(view, date);
  const data = await readRange(supabase, range.from, range.to);
  const days = summarizeDays({ ...range, today, ...data });
  const stats = periodStats(days);
  const focusDays = days.filter(day => day.inFocus).length;
  const label = view === 'week'
    ? `${shortDate(range.focusFrom, { day: 'numeric', month: 'short' })} – ${shortDate(range.focusTo, { day: 'numeric', month: 'short', year: 'numeric' })}`
    : shortDate(range.focusFrom, { month: 'long', year: 'numeric' });
  const todayAnchor = view === 'week' ? weekStart(today) : today;
  const dateAnchor = view === 'week' ? weekStart(date) : date;
  return <section className="dashboard-panel" aria-labelledby="period-title">
    <h2 id="period-title" className="visually-hidden">{view === 'week' ? 'Week' : 'Month'} view</h2>
    <PeriodNav view={view} label={label} prev={stepDate(view, date, -1)} next={stepDate(view, date, 1)}
      today={todayAnchor} date={view === 'month' ? (date.slice(0, 7) === today.slice(0, 7) ? today : date) : dateAnchor} />
    <PeriodStatsBar stats={stats} days={focusDays} />
    {view === 'week' ? <WeekGrid days={days} today={today} /> : <MonthGrid days={days} today={today} />}
    <Legend />
  </section>;
}

export async function DayView({ supabase, date, today, showAllHistory }: { supabase: Client; date: string; today: string; showAllHistory: boolean }) {
  const { dayWeight, foods, weights, totals, targets, exercises, exerciseTotals } = await readDashboard(supabase, date);
  const calorieTarget = targets ? Number(targets.calorie_target) : null;
  const proteinTarget = targets ? Number(targets.protein_target_g) : null;
  const remainingCalories = calorieTarget !== null ? calorieTarget - totals.calories : null;
  const remainingProtein = proteinTarget !== null ? proteinTarget - totals.proteinG : null;
  const trend = weightTrend(weights, today);
  const chart = trend.points.length >= 2 ? trendSvg(trend.points) : null;
  const history = [...weights].reverse();
  const shownHistory = showAllHistory ? history : history.slice(0, HISTORY_ROWS);
  const label = date === today ? `Today · ${shortDate(date, { weekday: 'short', day: 'numeric', month: 'short' })}`
    : shortDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return <>
    <section className="dashboard-panel" aria-labelledby="daily-title">
      <h2 id="daily-title" className="visually-hidden">Daily view</h2>
      <PeriodNav view="day" label={label} prev={addDays(date, -1)} next={addDays(date, 1)} today={today} date={date} />
      <div className="metrics">
        <div className="metric"><span>Calories</span><strong>{totals.calories.toLocaleString('en-AU')} <small>/ {calorieTarget !== null ? calorieTarget.toLocaleString('en-AU') : '—'} kcal</small></strong>
          <ProgressBar consumed={totals.calories} target={calorieTarget} label="Calories against target" />
          {remainingCalories !== null && <small className={remainingCalories < 0 ? 'target-over' : 'target-under'}>{remainingCalories < 0 ? `${kcal(Math.abs(remainingCalories))} over` : `${kcal(remainingCalories)} remaining`}</small>}</div>
        <div className="metric"><span>Protein</span><strong>{totals.proteinG.toFixed(1)} <small>/ {proteinTarget !== null ? proteinTarget.toFixed(0) : '—'} g</small></strong>
          <ProgressBar consumed={totals.proteinG} target={proteinTarget} label="Protein against target" />
          {remainingProtein !== null && <small className={remainingProtein <= 0 ? 'target-under' : 'target-pending'}>{remainingProtein <= 0 ? 'Target hit ✓' : `${grams(remainingProtein)} to go`}</small>}</div>
        <div className="metric"><span>Weight</span><strong>{dayWeight ? `${Number(dayWeight.weight_kg).toFixed(2)} kg` : '—'}</strong>
          {dayWeight?.body_fat_percent != null && <small>{Number(dayWeight.body_fat_percent).toFixed(1)}% body fat</small>}</div>
        <div className="metric"><span>Exercise</span><strong>{exerciseTotals.minutes ? `${exerciseTotals.minutes} min` : '—'}</strong>
          {exerciseTotals.caloriesBurned > 0 && <small>~{kcal(exerciseTotals.caloriesBurned)} burned (not added to target)</small>}</div>
      </div>

      <h3>Food</h3>
      {foods.length === 0 ? <p className="empty">No food logged for this day.</p> :
      <div className="table-scroll"><table>
        <thead><tr><th scope="col">Food</th><th scope="col" className="numeric">Calories</th><th scope="col" className="numeric">Protein</th></tr></thead>
        <tbody>{foods.map(food => <tr key={food.id}><td>{food.name}</td><td className="numeric">{kcal(Number(food.calories))}</td><td className="numeric">{grams(Number(food.protein_g))}</td></tr>)}</tbody>
        <tfoot><tr><th scope="row">Total</th><td className="numeric">{kcal(totals.calories)}</td><td className="numeric">{grams(totals.proteinG)}</td></tr></tfoot>
      </table></div>}

      <h3>Exercise</h3>
      {exercises.length === 0 ? <p className="empty">No exercise logged for this day.</p> : <>
      <div className="table-scroll"><table>
        <thead><tr><th scope="col">Activity</th><th scope="col" className="numeric">Duration</th><th scope="col" className="numeric">Est. burned</th><th scope="col">Notes</th></tr></thead>
        <tbody>{exercises.map(item => <tr key={item.id}>
          <td>{item.activity}</td>
          <td className="numeric">{item.duration_minutes != null ? `${item.duration_minutes} min` : '—'}</td>
          <td className="numeric">{item.calories_burned != null ? kcal(Number(item.calories_burned)) : '—'}</td>
          <td>{item.notes ?? ''}</td>
        </tr>)}</tbody>
        <tfoot><tr><th scope="row">Total</th><td className="numeric">{exerciseTotals.minutes} min</td><td className="numeric">{kcal(exerciseTotals.caloriesBurned)}</td><td /></tr></tfoot>
      </table></div>
      <p className="empty">Exercise calories are shown for reference and are not added to your calorie target.</p></>}
    </section>

    <section className="dashboard-panel" aria-labelledby="history-title">
      <h2 id="history-title">Weight trend</h2>
      {trend.weeklyChange
        ? <p className="trend-summary">Average weekly change (last 14 days): <strong>{trend.weeklyChange.kg > 0 ? '+' : ''}{trend.weeklyChange.kg.toFixed(2)} kg/week ({trend.weeklyChange.percent > 0 ? '+' : ''}{trend.weeklyChange.percent.toFixed(2)}%/week)</strong></p>
        : <p className="trend-summary">Weekly change appears once you have two weigh-ins on different days in the last 14 days.</p>}
      {chart ? <div className="trend-chart">
        <svg viewBox="0 0 800 262" role="img" aria-label="Weight by calendar day and trailing seven-day average" preserveAspectRatio="xMidYMid meet">
          <title>Weight trend</title>
          <desc>Dark line shows recorded weigh-ins. Green dashed line shows the trailing seven-calendar-day average. See the table below for exact values.</desc>
          <path d={chart.actual} fill="none" stroke="#26382e" strokeWidth="3" strokeLinejoin="round" />
          <path d={chart.average} fill="none" stroke="#718969" strokeWidth="3" strokeDasharray="7 5" strokeLinejoin="round" />
          {chart.dots.map(dot => <circle key={dot.date} cx={dot.x} cy={dot.y} r="4" fill="#26382e" />)}
          <g className="chart-axis" fontSize="13" fill="#5e695f">
            <text x="4" y="24">{chart.max.toFixed(1)} kg</text>
            <text x="4" y="228">{chart.min.toFixed(1)} kg</text>
            <text x="24" y="258">{shortDate(trend.points[0]!.date, { day: 'numeric', month: 'short' })}</text>
            <text x="776" y="258" textAnchor="end">{shortDate(trend.points[trend.points.length - 1]!.date, { day: 'numeric', month: 'short' })}</text>
          </g>
        </svg>
        <p className="chart-legend"><span className="legend-actual">● Daily weigh-ins</span> <span className="legend-average">┄ 7-day rolling average</span></p>
      </div> : weights.length > 0 && <p className="chart-placeholder">Log another weigh-in to start the trend chart.</p>}
      {weights.length === 0 ? <p className="empty">No weigh-ins yet.</p> : <>
      <div className="table-scroll"><table>
        <thead><tr><th scope="col">Date</th><th scope="col" className="numeric">Weight</th><th scope="col" className="numeric">Body fat</th></tr></thead>
        <tbody>{shownHistory.map(weight => <tr key={weight.id}>
          <td><Link href={href('day', weight.entry_date)}>{shortDate(weight.entry_date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</Link></td>
          <td className="numeric">{Number(weight.weight_kg).toFixed(2)} kg</td>
          <td className="numeric">{weight.body_fat_percent != null ? `${Number(weight.body_fat_percent).toFixed(1)}%` : '—'}</td>
        </tr>)}</tbody>
      </table></div>
      {history.length > HISTORY_ROWS && (showAllHistory
        ? <p><Link href={href('day', date)}>Show last {HISTORY_ROWS} only</Link></p>
        : <p><Link href={href('day', date, { history: 'all' })}>Show all {history.length} weigh-ins</Link></p>)}</>}
    </section>
  </>;
}
