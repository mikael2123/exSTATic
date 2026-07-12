<script lang="ts">
  import MenuOption from "../components/interface/menu_option.svelte";
  import { VNStorage } from "../vn/vn_storage";
  import { AVAILABLE_FONTS } from "../font_list";
  import BackupSettings from "./backup_settings.svelte";

  interface Props {
    vn_storage: VNStorage;
  }

  let { vn_storage }: Props = $props();
</script>

<div class="flex flex-col gap-6 px-20 pb-20">
  <div
    id="top_bar"
    class="sticky top-0 z-50 flex h-20 items-center justify-center bg-button bg-opacity-80"
  >
    <p class="header-text">Settings</p>
  </div>

  <div class="grid grid-cols-2 gap-1">
    <MenuOption
      media_storage={vn_storage}
      id="afk_max_time"
      description="Max AFK Time"
      units="secs"
      value="60"
    />
    <MenuOption
      media_storage={vn_storage}
      id="max_loaded_lines"
      description="Max Loaded Lines"
      units="UI"
      value="5000"
    />
    <MenuOption
      media_storage={vn_storage}
      id="day_rollover_hours"
      description="Day Starts At"
      units="hrs after midnight"
      value="0"
    />
    <MenuOption
      media_storage={vn_storage}
      id="font"
      description="Font"
      options={AVAILABLE_FONTS}
      value="Klee One"
      root_css="--default-font"
    />
    <MenuOption
      media_storage={vn_storage}
      id="font_size"
      description="Font Size"
      units="rem"
      value="2"
      root_css="--default-font-size"
    />
    <MenuOption
      media_storage={vn_storage}
      id="bottom_line_padding"
      description="Bottom Pushback"
      units="%"
      value="20"
      root_css="--default-text-align"
    />
    <MenuOption
      media_storage={vn_storage}
      id="inactivity_blur"
      description="Inactivity Blur"
      units="px"
      value="2"
    />
    <MenuOption
      media_storage={vn_storage}
      id="menu_blur"
      description="Menu Blur"
      units="px"
      value="8"
      root_css="--default-menu-blur"
    />
  </div>

  <BackupSettings />
</div>

<style global lang="postcss">
  @tailwind base;
  @tailwind components;
  @tailwind utilities;

  body {
    @apply bg-slate-800;
  }

  .menu-input {
    @apply col-start-2 grow bg-menu p-1 text-menu-text;
  }

  .menu-label {
    @apply bg-block p-4 text-icon;
  }

  .header-text {
    @apply inline-flex items-center text-4xl;
  }

  .header-icon {
    @apply h-full hover:bg-hover hover:hover:text-icon;
  }
</style>
