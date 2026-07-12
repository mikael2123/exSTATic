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

      select(axis).select("path").style("stroke", "grey");
    }
  });
</script>

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
