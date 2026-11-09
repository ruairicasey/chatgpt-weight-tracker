import { createProbeApp } from './probe.js';

function integer(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}
const port = integer('PORT', 3000, 1024, 65535);
const ttlSeconds = integer('PROBE_TTL_SECONDS', 900, 30, 900);
const probe = createProbeApp({
  ttlMs: ttlSeconds * 1000,
  onEvent: (event) => console.log(JSON.stringify({ time: new Date().toISOString(), ...event })),
});
const listener = probe.app.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ event: 'started', instanceId: probe.instanceId, port, ttlSeconds }));
});
listener.requestTimeout = 10_000;
listener.headersTimeout = 10_000;
listener.timeout = 10_000;
let stopped = false;
function stop() {
  if (stopped) return;
  stopped = true;
  clearTimeout(expiry);
  probe.clear();
  listener.close();
  listener.closeAllConnections();
  console.log(JSON.stringify({ event: 'stopped', instanceId: probe.instanceId }));
}
const expiry = setTimeout(stop, ttlSeconds * 1000);
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
listener.on('error', (error) => { console.error(error.message); stop(); process.exitCode = 1; });
