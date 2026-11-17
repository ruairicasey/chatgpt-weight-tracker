import Link from 'next/link';
import { redirect } from 'next/navigation';
import { loadSupabaseWebConfig } from '@weight-tracker/config/server';
import { requireWebOwner } from '@weight-tracker/auth/consent';
import { supabaseServer } from '../../lib/supabase';
import { readDashboard, selectedDate, melbourneToday } from '../../lib/dashboard-data';
import { weightTrend, trendSvg } from '../../lib/weight-trend';

export const dynamic = 'force-dynamic';

export default async function Dashboard({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let config;
  try { config = loadSupabaseWebConfig(process.env); }
  catch { redirect('/login'); }

  const supabase = await supabaseServer(config);
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');
  try { requireWebOwner(user, config); }
  catch { redirect('/login?error=1'); }

  const params = await searchParams;
  let date: string;
  try { date = selectedDate(params.date); }
  catch { return <main><h1>Invalid date</h1><p>Choose a valid date.</p><Link href="/dashboard">Return to today</Link></main>; }

  let data;
  try { data = await readDashboard(supabase, date); }
  catch { return <main className="dashboard"><h1>Dashboard unavailable</h1><p>Entries could not be loaded. Please try again.</p><Link href="/dashboard">Retry</Link></main>; }

  const { dayWeight, foods, weights, totals, targets } = data;
  const remainingCalories = targets ? Number(targets.calorie_target) - totals.calories : null;
  const remainingProtein = targets ? Number(targets.protein_target_g) - totals.proteinG : null;
  const trend = weightTrend(weights, melbourneToday());
  const chart = trendSvg(trend.points);
  return <main className="dashboard">
    <nav aria-label="Dashboard navigation"><Link href="/" className="brand"><span className="mark" aria-hidden="true">w.</span> Weight Tracker</Link><span>Owner dashboard</span></nav>
    <header className="dashboard-header">
      <p className="eyebrow">Your daily progress</p>
      <h1>Today &amp; beyond.</h1>
      <p>Read-only overview. Log, correct and delete entries through ChatGPT.</p>
    </header>

    <section className="dashboard-panel" aria-labelledby="daily-title">
      <div className="dashboard-heading">
        <h2 id="daily-title">Daily view</h2>
        <form method="get" action="/dashboard" className="date-form">
          <label htmlFor="day">Date</label>
          <input id="day" name="date" type="date" defaultValue={date} required />
          <button type="submit">View day</button>
        </form>
      </div>
      <div className="metrics">
        <div className="metric"><span>Weight</span><strong>{dayWeight ? `${Number(dayWeight.weight_kg).toFixed(2)} kg` : '—'}</strong></div>
        <div className="metric"><span>Body fat</span><strong>{dayWeight?.body_fat_percent != null ? `${Number(dayWeight.body_fat_percent).toFixed(1)}%` : '—'}</strong></div>
        <div className="metric"><span>Calories consumed / target</span><strong>{totals.calories.toLocaleString('en-AU')} / {targets ? Number(targets.calorie_target).toLocaleString('en-AU') : '—'} kcal</strong>
          {remainingCalories !== null && <small className={remainingCalories < 0 ? 'target-over' : 'target-under'}>{remainingCalories < 0 ? `${Math.abs(remainingCalories).toLocaleString('en-AU')} kcal over` : `${remainingCalories.toLocaleString('en-AU')} kcal remaining`}</small>}</div>
        <div className="metric"><span>Protein consumed / target</span><strong>{totals.proteinG.toFixed(1)} / {targets ? Number(targets.protein_target_g).toFixed(1) : '—'} g</strong>
          {remainingProtein !== null && <small className={remainingProtein < 0 ? 'target-over' : 'target-under'}>{remainingProtein < 0 ? `${Math.abs(remainingProtein).toFixed(1)} g over` : `${remainingProtein.toFixed(1)} g remaining`}</small>}</div>
      </div>
      <h3>Food entries</h3>
      {foods.length === 0 ? <p className="empty">No food entries logged for this day.</p> :
      <div className="table-scroll"><table>
        <thead><tr><th scope="col">Food</th><th scope="col" className="numeric">Calories</th><th scope="col" className="numeric">Protein</th></tr></thead>
        <tbody>{foods.map(food => <tr key={food.id}><td>{food.name}</td><td className="numeric">{Number(food.calories).toLocaleString('en-AU')} kcal</td><td className="numeric">{Number(food.protein_g).toFixed(1)} g</td></tr>)}</tbody>
        <tfoot><tr><th scope="row">Total</th><td className="numeric">{totals.calories.toLocaleString('en-AU')} kcal</td><td className="numeric">{totals.proteinG.toFixed(1)} g</td></tr></tfoot>
      </table></div>}
    </section>

    <section className="dashboard-panel" aria-labelledby="history-title">
      <h2 id="history-title">Weight history</h2>
      {trend.weeklyChange
        ? <p className="trend-summary">Average weekly change (last 14 days): <strong>{trend.weeklyChange.kg > 0 ? '+' : ''}{trend.weeklyChange.kg.toFixed(2)} kg/week ({trend.weeklyChange.percent > 0 ? '+' : ''}{trend.weeklyChange.percent.toFixed(2)}%/week)</strong></p>
        : <p className="trend-summary">Average weekly change: needs at least two weigh-ins on different dates within the last 14 days.</p>}
      {chart && <div className="trend-chart">
        <svg viewBox="0 0 800 240" role="img" aria-label="Weight by calendar day and trailing seven-day average, starting with the first weigh-in" preserveAspectRatio="xMidYMid meet">
          <title>Weight history trend</title>
          <desc>Dark line shows recorded weigh-ins. Green line shows the trailing seven-calendar-day average of available weigh-ins. See the table below for exact values.</desc>
          <path d={chart.actual} fill="none" stroke="#26382e" strokeWidth="3" strokeLinejoin="round" />
          <path d={chart.average} fill="none" stroke="#718969" strokeWidth="3" strokeDasharray="7 5" strokeLinejoin="round" />
          {chart.dots.map(dot => <circle key={dot.date} cx={dot.x} cy={dot.y} r="4" fill="#26382e" />)}
        </svg>
        <p className="chart-legend"><span className="legend-actual">● Daily weigh-ins</span> <span className="legend-average">┄ 7-day rolling average</span></p>
      </div>}
      {weights.length === 0 ? <p className="empty">No weigh-ins yet.</p> :
      <div className="table-scroll"><table>
        <thead><tr><th scope="col">Date</th><th scope="col" className="numeric">Weight</th><th scope="col" className="numeric">Body fat</th></tr></thead>
        <tbody>{weights.map(weight => <tr key={weight.id}>
          <td><Link href={`/dashboard?date=${weight.entry_date}`}>{weight.entry_date}</Link></td>
          <td className="numeric">{Number(weight.weight_kg).toFixed(2)} kg</td>
          <td className="numeric">{weight.body_fat_percent != null ? `${Number(weight.body_fat_percent).toFixed(1)}%` : '—'}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>
    <footer>Weight Tracker · Your entries remain in Supabase and are protected by your sign-in.</footer>
  </main>;
}
