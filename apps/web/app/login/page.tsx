import { loadSupabaseWebConfig } from '@weight-tracker/config/server';
import { authorizationId } from '@weight-tracker/auth/consent';

export const dynamic = 'force-dynamic';
export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  try { loadSupabaseWebConfig(process.env); } catch { return <main><h1>Owner login</h1><p>Authentication is not configured.</p></main>; }
  const params = await searchParams;
  let id = '';
  try { if (params.authorization_id !== undefined) id = authorizationId(params.authorization_id); }
  catch { return <main><h1>Invalid authorization request</h1></main>; }
  return <main className="mx-auto max-w-lg space-y-5 p-8">
    <h1 className="text-2xl font-semibold">Owner login</h1>
    <p>Sign in to approve your ChatGPT connection. Tracker logging is not enabled yet.</p>
    {params.error && <p role="alert">Sign-in failed or access was denied. Try again.</p>}
    {params.success && <p role="status">Signed in. Start the OAuth connection from ChatGPT.</p>}
    <form action="/login/submit" method="post" className="grid gap-4">
      <input type="hidden" name="authorization_id" value={id} />
      <label>Email <input className="border p-2" name="email" type="email" autoComplete="username" required maxLength={254} /></label>
      <label>Password <input className="border p-2" name="password" type="password" autoComplete="current-password" required maxLength={256} /></label>
      <button className="rounded bg-slate-900 p-3 text-white" type="submit">Sign in</button>
    </form>
  </main>;
}
