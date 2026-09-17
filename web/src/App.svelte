<script lang="ts">
  import GlobeCanvas from './ui/GlobeCanvas.svelte';
  import TopBar from './ui/TopBar.svelte';
  import TimeControls from './ui/TimeControls.svelte';
  import LayersPanel from './ui/LayersPanel.svelte';
  import GroupsPanel from './ui/GroupsPanel.svelte';
  import ObserverPanel from './ui/ObserverPanel.svelte';
  import StatusBar from './ui/StatusBar.svelte';
  import ObjectCard from './ui/ObjectCard.svelte';
  import HoverLabel from './ui/HoverLabel.svelte';
  import { settings } from './lib/state/settings.svelte';
  import { observer } from './lib/state/observer.svelte';
</script>

<main class="app">
  <GlobeCanvas />
  <HoverLabel />

  <div class="chrome top">
    <TopBar />
  </div>

  <div class="chrome object">
    <ObjectCard />
  </div>

  {#if settings.layersOpen}
    <div class="chrome layers">
      <LayersPanel />
    </div>
  {:else if settings.groupsOpen}
    <div class="chrome layers">
      <GroupsPanel />
    </div>
  {:else if observer.open}
    <div class="chrome layers">
      <ObserverPanel />
    </div>
  {/if}

  <div class="chrome bottom-left">
    <TimeControls />
  </div>

  <div class="chrome bottom-right">
    <StatusBar />
  </div>
</main>

<style>
  .app {
    position: relative;
    width: 100%;
    height: 100%;
  }

  .chrome {
    position: absolute;
    pointer-events: none; /* let drags reach the globe between panels */
  }

  .chrome :global(> *) {
    pointer-events: auto;
  }

  .top {
    top: 0;
    left: 0;
    right: 0;
  }

  .layers {
    top: 58px;
    right: 16px;
  }

  .object {
    top: 58px;
    left: 16px;
  }

  .bottom-left {
    left: 16px;
    bottom: 16px;
  }

  .bottom-right {
    right: 16px;
    bottom: 16px;
  }
</style>
