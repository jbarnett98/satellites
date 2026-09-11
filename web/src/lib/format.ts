import { RAD2DEG, TWO_PI } from './astro/time';

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 2026-09-11 16:54:03 UTC */
export function formatUtc(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '—';
  return (
    `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ` +
    `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} UTC`
  );
}

/** Value for an <input type="datetime-local"> (local time, minute precision). */
export function toDatetimeLocal(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  );
}

/** Sidereal angle (radians) as hh:mm:ss of sidereal time. */
export function formatSidereal(rad: number): string {
  const hours = ((rad % TWO_PI) + TWO_PI) % TWO_PI * (12 / Math.PI);
  const h = Math.floor(hours);
  const m = Math.floor((hours - h) * 60);
  const s = Math.floor(((hours - h) * 60 - m) * 60);
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

export function formatLat(deg: number): string {
  return `${Math.abs(deg).toFixed(2)}° ${deg >= 0 ? 'N' : 'S'}`;
}

export function formatLon(deg: number): string {
  return `${Math.abs(deg).toFixed(2)}° ${deg >= 0 ? 'E' : 'W'}`;
}

export function formatKm(km: number): string {
  return `${Math.round(km).toLocaleString('en-GB')} km`;
}

export function formatRate(rate: number): string {
  if (rate === 0) return 'paused';
  if (rate === 1) return '1×';
  return `${rate.toLocaleString('en-GB')}×`;
}

export { RAD2DEG };

/** "just now" · "4 min ago" · "1 h 12 min ago" · "3 d ago" */
export function formatAgo(ms: number, nowMs = Date.now()): string {
  const s = Math.max(0, (nowMs - ms) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${m - h * 60} min ago`;
  const d = Math.floor(h / 24);
  return `${d} d ${h - d * 24} h ago`;
}

/** Orbital period: "92.9 min" below two hours, "23 h 56 min" above. */
export function formatPeriod(minutes: number): string {
  if (!Number.isFinite(minutes)) return '—';
  if (minutes < 120) return `${minutes.toFixed(1)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes - h * 60);
  return `${h} h ${String(m).padStart(2, '0')} min`;
}

/** Element-set age: "6 h" · "1.4 d" */
export function formatAgeDays(days: number): string {
  if (!Number.isFinite(days)) return '—';
  if (days < 1) return `${Math.max(1, Math.round(days * 24))} h`;
  return `${days.toFixed(1)} d`;
}

export function formatMB(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

/** "2026-09-11 18:11 UTC" from an OMM epoch string. */
export function formatEpoch(iso: string): string {
  const ms = Date.parse(iso.endsWith('Z') ? iso : `${iso}Z`);
  return Number.isNaN(ms) ? iso : formatUtc(ms).replace(/:\d\d UTC$/, ' UTC');
}
