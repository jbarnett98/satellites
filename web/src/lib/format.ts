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
