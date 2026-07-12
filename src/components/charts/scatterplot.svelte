<script lang="ts">
  import LineAxis from "../draw/oriented_axis.svelte";
  import Circles from "../draw/circles.svelte";
  import Popup, {
    type TooltipAccessors,
    type TooltipFormatters,
  } from "./popup.svelte";
  import Legend from "../draw/legend.svelte";

  import { extent, group } from "d3-array";
  import { format } from "d3-format";
  import { timeFormat } from "d3-time-format";
  import { timeMonth } from "d3-time";
  import { scaleLinear, scaleTime } from "d3-scale";
  import iwanthue from "iwanthue";
  import type { DataEntry } from "../../data_wrangling/data_extraction";

  interface Props {
    data: DataEntry[];
    x_accessor: (d: Partial<DataEntry>) => Date;
    y_accessor: (d: DataEntry) => number;
    r_accessor: (d: Partial<DataEntry>) => number;
    c_accessor: (d: Partial<DataEntry>) => string;
    tooltip_accessors: TooltipAccessors;
    tooltip_formatters: TooltipFormatters;
    graph_title: string;
    x_label: string;
    y_label: string;
    // Overrides the Y axis tick/value formatter (defaults to `format(".2s")`,
    // used e.g. by the Time Read chart to render clean minute values).
    y_formatter?: (n: number | { valueOf(): number }) => string;
  }

  let {
    data,
    x_accessor,
    y_accessor,
    r_accessor,
    c_accessor,
    tooltip_accessors,
    tooltip_formatters,
    graph_title,
    x_label,
    y_label,
    y_formatter = format(".2s"),
  }: Props = $props();

  let radius = 60;

  let groups = $derived(Array.from(group(data, c_accessor).keys()));
  let hues = $derived(
    iwanthue(groups.length, {
      colorSpace: [0, 360, 0, 100, 50, 100],
      clustering: "force-vector",
      seed: "exSTATic!",
    }),
  );

  let [height, width, margin] = $state([1000, 1200, 50]);
  // Match the viewBox to the element's real pixel size so the graph fills it
  // (no square clamp → no letterboxing). The svg gets an explicit height in the
  // template so the figure measures a real tall value rather than collapsing.
  let safeHeight = $derived(Math.max(height, 500));
  let safeWidth = $derived(Math.max(width, 500));

  // Physical ranges shrink in proport to the maximal circle radius and padding
  let x_range = $derived([radius + margin, safeWidth - radius - margin]);
  let y_range = $derived([safeHeight - radius - margin, radius + margin]);

  // Map data (domains) onto physical scales (ranges)
  // Several of these functions can return undefined
  // Lift those up
  let x_scale = $derived.by(() => {
    const scale_extent = x_accessor && extent(data, x_accessor);
    if (
      scale_extent &&
      scale_extent[0] !== undefined &&
      scale_extent[1] !== undefined
    ) {
      return scaleTime().domain(scale_extent).range(x_range).nice();
    }
  });
  let y_scale = $derived.by(() => {
    const scale_extent = y_accessor && extent(data, y_accessor);
    if (
      scale_extent &&
      scale_extent[0] !== undefined &&
      scale_extent[1] !== undefined
    ) {
      // Scale dynamically to the data range so the trend fills the chart, but
      // never let the axis start below 0 — reading time / speed / chars can't be
      // negative, so a negative floor would be nonsensical.
      const scale = scaleLinear().domain(scale_extent).range(y_range).nice();
      if (scale.domain()[0] < 0) {
        scale.domain([0, scale.domain()[1]]);
      }
      return scale;
    }
  });
  let r_scale = $derived.by(() => {
    const scale_extent = r_accessor && extent(data, r_accessor);
    if (
      scale_extent &&
      scale_extent[0] !== undefined &&
      scale_extent[1] !== undefined
    ) {
      return scaleLinear().domain([0, scale_extent[1]]).range([0, radius]);
    }
  });

  const xGet = (d: Partial<DataEntry>) => x_scale && x_scale(x_accessor(d));
  const yGet = (d: DataEntry) => y_scale && y_scale(y_accessor(d));
  const rGet = (d: DataEntry) =>
    r_accessor && r_scale && r_scale(r_accessor(d));
  const cGet = (d: DataEntry) => hues[groups.indexOf(c_accessor(d))];

  // One tick per calendar month (see `tick_interval={timeMonth}` below); show
  // the abbreviated month, and only print the year under the January tick so
  // it doesn't repeat on every label.
  const month_formatter = timeFormat("%b");
  const year_formatter = timeFormat("%Y");
  const x_formatter = (d: Date) =>
    d.getMonth() === 0
      ? `${month_formatter(d)}\n${year_formatter(d)}`
      : month_formatter(d);

  let mouse_move: (event: MouseEvent) => void = $state(() => {});
  let mouse_out: () => void = $state(() => {});
</script>

<div class="flex h-full w-full flex-col items-center bg-slate-900 p-12">
  <h1 class="text-4xl font-semibold text-indigo-400">{graph_title}</h1>

  <figure
    bind:clientHeight={height}
    bind:clientWidth={width}
    class="flex w-full flex-row items-center"
  >
    <svg
      class="h-[78vh] max-h-[80vh] w-full"
      style="resize: both;"
      viewBox="0 0 {safeWidth} {safeHeight}"
      preserveAspectRatio="xMidYMid meet"
    >
      <LineAxis
        scale={x_scale}
        height={safeHeight}
        width={safeWidth}
        {margin}
        position="bottom"
        formatter={x_formatter}
        label={x_label}
        tick_interval={timeMonth}
      />
      <LineAxis
        scale={y_scale}
        height={safeHeight}
        width={safeWidth}
        {margin}
        position="left"
        formatter={y_formatter}
        label={y_label}
      />

      <Circles
        {data}
        {xGet}
        {yGet}
        {rGet}
        {cGet}
        {x_scale}
        {y_scale}
        bind:mouse_move
        bind:mouse_out
      />
    </svg>

    <Legend {groups} {hues} />

    <Popup
      {data}
      {groups}
      {hues}
      date_accessor={x_accessor}
      group_accessor={c_accessor}
      {tooltip_accessors}
      {tooltip_formatters}
      bind:mouse_move
      bind:mouse_out
    />
  </figure>
</div>
