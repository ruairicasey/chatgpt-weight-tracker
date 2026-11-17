import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { loadSupabaseWebConfig } from '@weight-tracker/config/server';
import { requireWebOwner } from '@weight-tracker/auth/consent';
import { supabaseServer } from '../../lib/supabase';
import { selectedDate, melbourneToday } from '../../lib/dashboard-data';
import { parseView } from '../../lib/periods';
import { ViewTabs } from './components';
import { DayView, PeriodView } from './views';

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
  const view = parseView(params.view);
  const today = melbourneToday();
  let date: string;
  try { date = selectedDate(params.date); }
  catch { return <main className="dashboard"><h1>Invalid date</h1><p>Choose a valid date.</p><Link href="/dashboard">Return to today</Link></main>; }

  let body: ReactNode;
  try {
    body = view === 'day'
      ? await DayView({ supabase, date, today, showAllHistory: params.history === 'all' })
      : await PeriodView({ supabase, view, date, today });
  } catch {
    body = <section className="dashboard-panel"><h2>Dashboard unavailable</h2><p>Entries could not be loaded. Please try again.</p><Link href="/dashboard">Retry</Link></section>;
  }

  return <main className="dashboard">
    <nav aria-label="Dashboard navigation">
      <Link href="/" className="brand"><span className="mark" aria-hidden="true">w.</span> Weight Tracker</Link>
      <form method="post" action="/logout"><button type="submit" className="link-button">Sign out</button></form>
    </nav>
    <header className="dashboard-bar">
      <ViewTabs view={view} date={date} />
      <p className="dashboard-hint">Log, correct and delete entries through ChatGPT.</p>
    </header>
    {body}
    <footer>Weight Tracker · Your entries remain in Supabase and are protected by your sign-in.</footer>
  </main>;
}
