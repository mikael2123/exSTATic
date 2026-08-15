<script lang="ts">
  import { charsInLine } from "../../calculations";

  interface Props {
    id: string;
    time: string;
    sentence?: string;
    // Selection lives in the tracker page's state, not in this checkbox — the
    // delete button and shift-click ranges both need to read/write it.
    selected?: boolean;
    // Characters (as counted for stats) at or above which the ⚡ hint shows.
    // 0 or less disables it. Purely a visual hint: it never touches stats.
    flag_threshold?: number;
    onToggle?: (event: MouseEvent) => void;
  }

  let {
    id,
    time,
    sentence = "",
    selected = false,
    flag_threshold = 0,
    onToggle = undefined,
  }: Props = $props();

  // charsInLine, not sentence.length: this is the count exSTATic actually
  // credits to the stats, so the threshold means "would have added N chars".
  const chars = $derived(charsInLine(sentence));
  const flagged = $derived(flag_threshold > 0 && chars >= flag_threshold);

  // Shift-clicking otherwise drags a text selection across the whole page.
  const suppressShiftDrag = (event: MouseEvent) => {
    if (event.shiftKey) event.preventDefault();
  };

  // Stop here so a click never reaches the line holder's menu-closing onclick
  // or the feed's ondblclick, which pauses/resumes the reading timer.
  const handleClick = (event: MouseEvent) => {
    event.stopPropagation();
    onToggle?.(event);
  };

  const handleDoubleClick = (event: MouseEvent) => event.stopPropagation();
</script>

<div
  class="sentence-entry w-full"
  class:selected
  data-line-id={id}
  data-time={time}
>
  <p class="sentence">{sentence}</p>
  <!-- The hit area is a fixed-width gutter at the row's right edge, the same on
       every row however short the text is. The text itself is deliberately not
       a target — clicks on it belong to dictionary lookups. -->
  <span
    class="line-select-hit"
    role="presentation"
    onmousedown={suppressShiftDrag}
    onclick={handleClick}
    ondblclick={handleDoubleClick}
  >
    {#if flagged}
      <span class="skip-flag" title="{chars} characters — possible skip"
        >⚡</span
      >
    {/if}
    <input type="checkbox" class="line-select" checked={selected} />
  </span>
</div>
