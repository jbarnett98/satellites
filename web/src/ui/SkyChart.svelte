<script lang="ts">
  /**
   * The observer's sky as a chart: the whole hemisphere above them, zenith in the middle,
   * horizon at the rim, drawn the way a planisphere is — held overhead, so north is up and
   * east is on the LEFT. Every object above the horizon is a dot; the selected object's
   * pass is drawn as a track with its naked-eye-visible stretch in the accent colour.
   */
  import { catalog } from '../lib/state/catalog.svelte';
  import { observer } from '../lib/state/observer.svelte';
  import { settings } from '../lib/state/settings.svelte';
  import { REGIME_COLORS, TYPE_COLORS } from '../lib/globe/satellites';
  import type { Pass } from '../lib/orbits/predictPasses';
  import { formatClock } from '../lib/format';

  let { track = null, size = 300 }: { track?: Pass | null; size?: number } = $props();

  let canvas: HTMLCanvasElement;
  const HIT_PX = 9;

  // Chart geometry: elevation → radius (linear, so 30° rings are evenly spaced), azimuth → angle with east on the left.
  const project = (azDeg: number, elDeg: number, r: number): [number, number] => {
    const rr = ((90 - elDeg) / 90) * r;
    const a = (azDeg * Math.PI) / 180;
    return [-Math.sin(a) * rr, -Math.cos(a) * rr];
  };

  function nearest(px: number, py: number): number {
    const scan = observer.scan;
    if (!scan) return -1;
    const r = size / 2 - 14;
    const e = scan.entries;
    let best = -1;
    let bestD = HIT_PX * HIT_PX;
    for (let k = 0; k < e.length; k += 4) {
      const [x, y] = project(e[k + 1], e[k + 2], r);
      const d = (x - px) ** 2 + (y - py) ** 2;
      if (d < bestD) {
        bestD = d;
        best = e[k];
      }
    }
    return best;
  }

  function local(ev: MouseEvent): [number, number] {
    const rect = canvas.getBoundingClientRect();
    return [ev.clientX - rect.left - size / 2, ev.clientY - rect.top - size / 2];
  }

  function onMove(ev: MouseEvent) {
    const [x, y] = local(ev);
    const i = nearest(x, y);
    if (i !== observer.hoveredIndex) observer.hoveredIndex = i;
  }

  function onLeave() {
    observer.hoveredIndex = -1;
  }

  function onClick(ev: MouseEvent) {
    const [x, y] = local(ev);
    const i = nearest(x, y);
    if (i >= 0) catalog.select(i);
  }

  $effect(() => {
    const scan = observer.scan;
    const cat = catalog.catalog;
    const selected = catalog.selected;
    const hovered = observer.hoveredIndex >= 0 ? observer.hoveredIndex : catalog.hovered;
    const colorBy = settings.satellites.colorBy;
    const minEl = observer.minElevationDeg;
    const zone = observer.timeZone;
    const pass = track;
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (canvas.width !== size * dpr) {
      canvas.width = size * dpr;
      canvas.height = size * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.translate(size / 2, size / 2);
    const r = size / 2 - 14;

    // Sky disc and the elevation rings.
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8, 13, 22, 0.9)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(168, 188, 214, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = 'rgba(168, 188, 214, 0.16)';
    for (const el of [30, 60]) {
      ctx.beginPath();
      ctx.arc(0, 0, (r * (90 - el)) / 90, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (minEl > 0 && minEl !== 30 && minEl !== 60) {
      ctx.strokeStyle = 'rgba(79, 198, 208, 0.35)';
      ctx.beginPath();
      ctx.arc(0, 0, (r * (90 - minEl)) / 90, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(168, 188, 214, 0.12)';
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(0, r);
    ctx.moveTo(-r, 0);
    ctx.lineTo(r, 0);
    ctx.stroke();

    // Compass, as seen looking up: east on the left.
    ctx.fillStyle = 'rgba(138, 151, 171, 0.9)';
    ctx.font = '600 11px "Barlow Semi Condensed", "Barlow", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', 0, -r - 8);
    ctx.fillText('S', 0, r + 8);
    ctx.fillText('E', -r - 8, 0);
    ctx.fillText('W', r + 8, 0);

    // The pass track: grey where the object is unlit or the sky is bright, accent where you could see it.
    if (pass && pass.samples.length > 1) {
      const s = pass.samples;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      for (let k = 1; k < s.length; k++) {
        const a = project(s[k - 1].azDeg, Math.max(0, s[k - 1].elDeg), r);
        const b = project(s[k].azDeg, Math.max(0, s[k].elDeg), r);
        ctx.strokeStyle = s[k].visible && s[k - 1].visible ? 'rgba(79, 198, 208, 0.95)' : 'rgba(168, 188, 214, 0.35)';
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      }
      // Rise and set times at the ends.
      ctx.font = '11px "IBM Plex Mono", monospace';
      ctx.fillStyle = 'rgba(230, 235, 243, 0.85)';
      const first = s[0];
      const last = s[s.length - 1];
      const [x0, y0] = project(first.azDeg, 0, r + 1);
      const [x1, y1] = project(last.azDeg, 0, r + 1);
      ctx.textAlign = x0 < 0 ? 'right' : 'left';
      ctx.fillText(formatClock(first.ms, zone), x0 + (x0 < 0 ? -4 : 4), y0 + (y0 < 0 ? -8 : 8));
      ctx.textAlign = x1 < 0 ? 'right' : 'left';
      ctx.fillText(formatClock(last.ms, zone), x1 + (x1 < 0 ? -4 : 4), y1 + (y1 < 0 ? -8 : 8));
    }

    // Every object above the horizon.
    if (scan && cat) {
      const e = scan.entries;
      const palette = colorBy === 'regime' ? REGIME_COLORS : TYPE_COLORS;
      const codes = colorBy === 'regime' ? cat.regimeCode : cat.typeCode;
      for (let k = 0; k < e.length; k += 4) {
        const i = e[k];
        const [x, y] = project(e[k + 1], e[k + 2], r);
        ctx.fillStyle = palette[codes[i]];
        ctx.beginPath();
        ctx.arc(x, y, e[k + 2] >= minEl ? 2 : 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
      // Hovered and selected get rings and a name.
      const mark = (index: number, ring: string, label: boolean) => {
        for (let k = 0; k < e.length; k += 4) {
          if (e[k] !== index) continue;
          const [x, y] = project(e[k + 1], e[k + 2], r);
          ctx.strokeStyle = ring;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, 6, 0, Math.PI * 2);
          ctx.stroke();
          if (label) {
            ctx.font = '600 12px "Barlow Semi Condensed", "Barlow", sans-serif';
            ctx.fillStyle = '#e6ebf3';
            ctx.textAlign = x > r * 0.5 ? 'right' : 'left';
            ctx.textBaseline = 'bottom';
            ctx.fillText(cat.data.OBJECT_NAME[index], x + (x > r * 0.5 ? -9 : 9), y - 4);
          }
          return;
        }
      };
      if (selected >= 0) mark(selected, '#ffffff', hovered < 0 || hovered === selected);
      if (hovered >= 0 && hovered !== selected) mark(hovered, 'rgba(255,255,255,0.7)', true);
    }
  });
</script>

<canvas
  bind:this={canvas}
  class="chart"
  style:width={`${size}px`}
  style:height={`${size}px`}
  onmousemove={onMove}
  onmouseleave={onLeave}
  onclick={onClick}
  aria-label="Sky chart: objects above the horizon, north up, east left"
></canvas>

<style>
  .chart {
    display: block;
    cursor: crosshair;
  }
</style>
