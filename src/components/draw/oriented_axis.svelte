<script lang="ts">
  import { select } from "d3-selection";
  import type { ScaleBand, ScaleLinear, ScaleTime } from "d3-scale";
  import {
    axisTop,
    axisRight,
    axisBottom,
    axisLeft,
    axisLabelOffset,
  } from "@d3fc/d3fc-axis";

  interface Props {
    scale:
      | ScaleBand<string>
      | ScaleLinear<number, number>
      | ScaleTime<number, number>
      | undefined;
    height: number;
    width: number;
    margin: number;
    position: "top" | "right" | "bottom" | "left";
    formatter:
      | ((date: (x_value: string) => string) => string)
      | ((n: number | { valueOf(): number }) => string)
      | ((x_value: string) => string)
      | ((date: Date) => string);
    label?: string;
    // Passed straight through to the d3fc axis' `.ticks()` when provided
    // (e.g. `timeMonth` to force exactly one tick per calendar month).
    // Left undefined, the axis falls back to its own default tick count.
    tick_interval?: any;
  }

  let {
    scale = $bindable(),
    height = $bindable(),
    width = $bindable(),
    margin,
    position,
    formatter,
    label = "",
    tick_interval = undefined,
  }: Props = $props();

  let axis: SVGGElement | undefined = $state();
  let transform = $state("0,0");

  const positionedAxis = (
    scale:
      | ScaleBand<string>
      | ScaleLinear<number, number>
      | ScaleTime<number, number>
      | undefined,
  ) => {
    if (position === "top") {
      return axisLabelOffset(axisTop(scale));
    } else if (position == "right") {
      return axisRight(scale);
    } else if (position === "bottom") {
      return axisLabelOffset(axisBottom(scale));
    } else if (position == "left") {
      return axisLeft(scale);
    }
  };

  const transitionAxis = () => {
    if (position === "top") {
      transform = `0,${margin}`;
    } else if (position == "right") {
      transform = `${width - margin},0`;
    } else if (position === "bottom") {
      transform = `0,${height - margin}`;
    } else if (position == "left") {
      transform = `${margin},0`;
    }
  };

  // Pixel positions for gridlines, drawn at each tick and spanning the full
  // plot. Only continuous (linear/time) scales expose `.ticks()`; band/category
  // axes are skipped so a bar chart doesn't get a vertical line per category.
  let gridlines = $derived.by(() => {
    const s: any = scale;
    if (!s || !height || !width || typeof s.ticks !== "function") {
      return [] as number[];
    }
    const values =
      tick_interval !== undefined ? s.ticks(tick_interval) : s.ticks();
    return values.map((v: any) => s(v) as number);
  });

  $effect(() => {
    if (height && width && margin && position && axis && scale) {
      const axis_creator = positionedAxis(scale)
        .tickSizeOuter(0)
        .tickSize(0)
        .tickFormat(formatter);

      if (tick_interval !== undefined) {
        axis_creator.ticks(tick_interval);
      }

      axis_creator(select(axis));
      transitionAxis();

      // Hide d3fc's own domain path: it only spans the scale's data range (in
      // the scatter plot that's inset by the circle radius), so it stops short
      // of the corner. We draw the spine ourselves below to span the full plot.
      select(axis).select("path").style("stroke", "none");
    }
  });
</script>

<!-- Subtle gridlines at each tick, spanning the full plot. Drawn first so they
     sit behind the spine, tick labels and the plotted data. -->
<g class="gridlines">
  {#each gridlines as p}
    {#if position === "bottom" || position === "top"}
      <line
        x1={p}
        x2={p}
        y1={margin}
        y2={height - margin}
        stroke="grey"
        stroke-opacity="0.18"
      />
    {:else}
      <line
        x1={margin}
        x2={width - margin}
        y1={p}
        y2={p}
        stroke="grey"
        stroke-opacity="0.18"
      />
    {/if}
  {/each}
</g>
<!-- Axis spine spanning the full plot so the x and y axes meet cleanly at the
     corner, regardless of any radius/padding inset on the data scale's range. -->
{#if position === "bottom" || position === "top"}
  <line
    x1={margin}
    x2={width - margin}
    y1={position === "bottom" ? height - margin : margin}
    y2={position === "bottom" ? height - margin : margin}
    stroke="grey"
  />
{:else}
  <line
    x1={position === "left" ? margin : width - margin}
    x2={position === "left" ? margin : width - margin}
    y1={margin}
    y2={height - margin}
    stroke="grey"
  />
{/if}
<g
  color="grey"
  stroke="grey"
  fill="grey"
  bind:this={axis}
  transform="translate({transform})"
/>
{#if position === "top"}
  <text x={(width + margin) / 2} y={30} fill="grey">{label}</text>
{:else if position === "right"}
  <text
    x={(height + margin) * -0.5}
    y={width - 10}
    fill="grey"
    transform="rotate(-90)">{label}</text
  >
{:else if position === "bottom"}
  <text x={(width + margin) / 2} y={height - margin + 45} fill="grey"
    >{label}</text
  >
{:else if position === "left"}
  <text
    x={(height + margin) * -0.5}
    y={margin - 30}
    fill="grey"
    transform="rotate(-90)">{label}</text
  >
{/if}
