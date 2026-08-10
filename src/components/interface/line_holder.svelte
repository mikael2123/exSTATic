<script lang="ts">
  import Line from "./line.svelte";
  import { tick } from "svelte";

  interface Props {
    lines: string[][];
    // Selection state, keyed by numeric line id and owned by the tracker page.
    selected?: Record<number, boolean>;
    flag_threshold?: number;
    // Reports which row was clicked so the page can resolve shift-click ranges.
    onToggle?: (index: number, shiftKey: boolean) => void;
    onclick: () => void;
    ondblclick: ((this: Window, ev: MouseEvent) => any) | null;
  }

  let {
    lines = $bindable(),
    selected = {},
    flag_threshold = 0,
    onToggle = undefined,
    onclick,
    ondblclick,
  }: Props = $props();
  let entry_holder: HTMLElement | undefined = $state();
  // Plain let, not $state: the effect writes it, and it must not re-trigger it.
  let previous_length = 0;

  $effect.pre(() => {
    const length = lines.length;
    // Only follow the feed when it grows. Deleting shrinks `lines`, and
    // jumping to the bottom there would throw away the scroll position you
    // just spent time scrolling up to.
    const grew = length > previous_length;
    previous_length = length;

    if (!entry_holder || length === 0 || !grew) return;

    tick().then(() => window.scrollTo(0, entry_holder?.scrollHeight ?? 0));
  });
</script>

<div
  id="entry_holder"
  bind:this={entry_holder}
  role="presentation"
  {onclick}
  {ondblclick}
>
  <!-- Keyed by line id: an unkeyed block reuses DOM by index, so the selection
       highlight would smear onto the wrong rows once a delete filters `lines`. -->
  {#each lines as [_, id, line, time], index (id)}
    <Line
      {id}
      {time}
      sentence={line}
      {flag_threshold}
      selected={selected[Number(id)] ?? false}
      onToggle={(event) => onToggle?.(index, event.shiftKey)}
    />
  {/each}
</div>

<style lang="postcss">
  #entry_holder {
    @apply flex h-full w-full flex-col gap-2;
    padding-bottom: var(--default-text-align);
  }
</style>
