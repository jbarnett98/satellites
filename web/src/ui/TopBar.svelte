<script lang="ts">
  import { clock } from '../lib/state/clock.svelte';
  import { settings } from '../lib/state/settings.svelte';
  import { formatRate, formatUtc } from '../lib/format';

  const utc = $derived(formatUtc(clock.simTime));
  const modeLabel = $derived(clock.live ? 'LIVE' : clock.paused ? 'PAUSED' : `SIM ${formatRate(clock.rate)}`);
</script>

<header class="bar">
  <div class="brand">
    <span class="wordmark">Atmospheric Perspective</span>
    <span class="tag eyebrow">Earth orbit · real time</span>
  </div>

  <div class="right">
    <div class="time" title="Simulation time (UTC)">
      <span class="mono utc">{utc}</span>
      <span
        class="mode mono"
        class:live={clock.live}
        class:paused={clock.paused}
        class:sim={!clock.live && !clock.paused}
      >
        {modeLabel}
      </span>
    </div>

    <div class="seg" role="group" aria-label="Reference frame">
      <button
        class="btn"
        class:is-active={settings.frame === 'eci'}
        onclick={() => (settings.frame = 'eci')}
        title="Inertial frame: the sky holds still, the Earth turns"
      >
        Inertial
      </button>
      <button
        class="btn"
        class:is-active={settings.frame === 'ecef'}
        onclick={() => (settings.frame = 'ecef')}
        title="Earth-fixed frame: the Earth holds still, the sky turns"
      >
        Earth-fixed
      </button>
    </div>

    <button
      class="btn"
      class:is-active={settings.layersOpen}
      aria-expanded={settings.layersOpen}
      onclick={() => (settings.layersOpen = !settings.layersOpen)}
    >
      Layers
    </button>
  </div>
</header>

<style>
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 16px;
    background: linear-gradient(to bottom, rgba(4, 7, 12, 0.8), rgba(4, 7, 12, 0));
  }

  .brand {
    display: flex;
    align-items: baseline;
    gap: 12px;
  }

  .wordmark {
    font-family: var(--font-head);
    font-weight: 700;
    font-size: 19px;
    letter-spacing: 0.01em;
  }

  .tag {
    color: var(--faint);
  }

  .right {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .time {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 10px;
    height: 30px;
    border: 1px solid var(--panel-border);
    border-radius: var(--radius);
    background: var(--panel);
  }

  .utc {
    font-size: 13px;
  }

  .mode {
    font-size: 11px;
    letter-spacing: 0.08em;
    padding: 1px 6px;
    border-radius: 3px;
    color: var(--bg);
    background: var(--muted);
  }

  .mode.live {
    background: var(--live);
  }

  .mode.sim {
    background: var(--accent);
  }

  .mode.paused {
    background: var(--warn);
  }
</style>
