<script lang="ts">
  import type { MediaStorage } from "../../storage/media_storage";

  import { onMount } from "svelte";
  import type { HTMLInputTypeAttribute } from "svelte/elements";
  import type { TypeProperties } from "../../storage/type_storage";

  interface Props {
    media_storage: MediaStorage;
    id: keyof TypeProperties;
    description?: string;
    units?: string;
    type?: HTMLInputTypeAttribute;
    value?: string | number | undefined;
    root_css?: string | undefined;
    // When provided, render a dropdown of these choices plus a "Custom…" entry
    // that reveals a free-text box (so any installed font/name still works).
    options?: string[];
  }

  let {
    media_storage,
    id,
    description = "",
    units = "",
    type = "number",
    value = $bindable(),
    root_css = undefined,
    options = undefined,
  }: Props = $props();

  const CUSTOM = "__custom__";
  let input_element: HTMLInputElement | undefined = $state();
  let selectValue = $state(CUSTOM);
  let showCustom = $state(false);

  // Single place that persists a value: update the CSS variable and storage.
  const apply = async (new_value: string) => {
    value = new_value;

    if (root_css !== undefined) {
      document.documentElement.style.setProperty(root_css, `${value}${units}`);
    }

    if (media_storage && media_storage.type_storage) {
      await media_storage.type_storage.updateProperties({ [id]: value });
    }
  };

  const update = async (event: Event) => {
    await apply((event.target as HTMLInputElement).value);
  };

  const onSelect = async (event: Event) => {
    const chosen = (event.target as HTMLSelectElement).value;
    selectValue = chosen;

    if (chosen === CUSTOM) {
      showCustom = true;
    } else {
      showCustom = false;
      await apply(chosen);
    }
  };

  onMount(async () => {
    // Load the stored value if present, otherwise persist the provided default.
    if (media_storage.properties.hasOwnProperty(id)) {
      value = media_storage.properties[id];
    } else {
      await media_storage.type_storage.updateProperties({ [id]: value });
    }

    const current = (value ?? "").toString();

    if (options) {
      if (current && options.includes(current)) {
        selectValue = current;
        showCustom = false;
      } else {
        selectValue = CUSTOM;
        showCustom = current !== "";
      }
    }

    // Ensure the CSS variable reflects the resolved value on load.
    if (root_css !== undefined) {
      document.documentElement.style.setProperty(root_css, `${current}${units}`);
    }
  });
</script>

<div class="menu-label">
  {description}{#if units != ""}{" "}({units}){/if}
</div>

{#if options}
  <div class="menu-input flex flex-col gap-1">
    <select class="bg-menu text-menu-text" value={selectValue} onchange={onSelect}>
      {#each options as option}
        <option value={option}>{option}</option>
      {/each}
      <option value={CUSTOM}>Custom…</option>
    </select>
    {#if showCustom}
      <input
        bind:this={input_element}
        class="bg-menu text-menu-text"
        type="text"
        placeholder="Type a font name"
        {value}
        onchange={update}
      />
    {/if}
  </div>
{:else}
  <input
    bind:this={input_element}
    class="menu-input"
    {type}
    {value}
    onchange={update}
  />
{/if}
