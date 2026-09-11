<script lang="ts">
  import { clock, RATES } from '../lib/state/clock.svelte';
  import { formatRate, toDatetimeLocal } from '../lib/format';

  // The date picker shows the sim time but only writes back when the user commits a value.
  const pickerValue = $derived(toDatetimeLocal(clock.simTime));

  function onPick(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value;
    if (!v) return;
    const ms = new Date(v).getTime();
    if (Number.isFinite(ms)) clock.setTime(ms);
  }
</script>

<section class="panel controls" aria-label="Time controls">
  <div class="row">
    <span class="eyebrow">Time</span>
    <button class="btn" class:is-active={clock.live} onclick={() => clock.goLive()} title="Follow the real clock">
      ● Now
    </button>
    <button class="btn" onclick={() => clock.togglePause()} title={clock.paused ? 'Play' : 'Pause'}>
      {clock.paused ? '▶' : '❚❚'}
    </button>
  </div>

  <div class="row">
    <span class="eyebrow">Rate</span>
    <div class="seg" role="group" aria-label="Playback rate">
      {#each RATES as rate (rate)}
        <button
          class="btn mono"
          class:is-active={!clock.live && clock.rate === rate}
          onclick={() => clock.play(rate)}
          title={`Run at ${formatRate(rate)} real time`}
        >
          {formatRate(rate)}
        </button>
      {/each}
    </div>
  </div>

  <div class="row">
    <span class="eyebrow">Jump</span>
    <input class="mono picker" type="datetime-local" value={pickerValue} onchange={onPick} aria-label="Jump to date and time" />
  </div>
</section>

<style>
  .controls {
    display: grid;
    gap: 8px;
    padding: 10px 12px;
    min-width: 330px;
  }

  .row {
    display: grid;
    grid-template-columns: 44px 1fr auto;
    align-items: center;
    gap: 8px;
  }

  .row > .seg {
    grid-column: 2 / -1;
    justify-self: start;
  }

  .row > .picker {
    grid-column: 2 / -1;
  }

  .picker {
    height: 30px;
    padding: 0 8px;
    border: 1px solid var(--panel-border);
    border-radius: var(--radius);
    background: rgba(255, 255, 255, 0.03);
    color: var(--ink);
    font-size: 12.5px;
    color-scheme: dark;
  }
</style>
