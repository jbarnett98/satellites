<script lang="ts">
  import { onMount } from 'svelte';
  import { Globe, type LayerName } from '../lib/globe/Globe';
  import { clock } from '../lib/state/clock.svelte';
  import { settings } from '../lib/state/settings.svelte';
  import { status } from '../lib/state/status.svelte';

  let canvas: HTMLCanvasElement;
  let globe = $state.raw<Globe | undefined>(undefined);

  onMount(() => {
    const g = new Globe(canvas, {
      timeSource: () => clock.tick(),
      onProgress: (label) => (status.loadMessage = label),
      onReady: () => (status.ready = true),
      onError: (err) => {
        console.error(err);
        status.error = err instanceof Error ? err.message : String(err);
      },
      onStatus: (s) => {
        status.fps = s.fps;
        status.gmstRad = s.gmstRad;
        status.subsolarLatDeg = s.sun.subsolarLatDeg;
        status.subsolarLonDeg = s.sun.subsolarLonDeg;
        status.sunDeclinationDeg = s.sun.declinationDeg;
        status.cameraAltitudeKm = s.cameraAltitudeKm;
        status.cameraLatDeg = s.cameraLatDeg;
        status.cameraLonDeg = s.cameraLonDeg;
        status.starCount = s.starCount;
      },
    });
    globe = g;
    g.start();

    // Dev-only handle for poking at the scene from the console.
    if (import.meta.env.DEV) (window as unknown as { __globe?: Globe }).__globe = g;

    const ro = new ResizeObserver(() => g.resize());
    ro.observe(canvas.parentElement!);

    return () => {
      ro.disconnect();
      g.dispose();
      globe = undefined;
    };
  });

  // Push UI state into the renderer whenever it changes.
  $effect(() => {
    globe?.setFrame(settings.frame);
  });

  $effect(() => {
    const g = globe;
    if (!g) return;
    for (const name of Object.keys(settings.layers) as LayerName[]) {
      g.setLayer(name, settings.layers[name]);
    }
  });
</script>

<div class="stage">
  <canvas bind:this={canvas}></canvas>

  {#if !status.ready}
    <div class="loading" role="status" aria-live="polite">
      {#if status.error}
        <span class="eyebrow err">Renderer error</span>
        <span class="mono">{status.error}</span>
      {:else}
        <span class="eyebrow">Atmospheric Perspective</span>
        <span class="msg">{status.loadMessage}…</span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .stage {
    position: absolute;
    inset: 0;
    background: var(--bg);
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
  }

  .loading {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 8px;
    background: var(--bg);
    color: var(--muted);
  }

  .loading .msg {
    font-family: var(--font-mono);
    font-size: 13px;
  }

  .err {
    color: var(--warn);
  }
</style>
