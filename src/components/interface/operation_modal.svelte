<script lang="ts">
  interface Props {
    open: boolean;
    title: string;
    note?: string;
    issues?: string[];
    progress?: { done: number; total: number } | null;
    onProceed?: (() => void) | undefined;
    onCancel?: (() => void) | undefined;
    proceedLabel?: string;
    cancelLabel?: string;
  }

  let {
    open,
    title,
    note = "",
    issues = undefined,
    progress = null,
    onProceed = undefined,
    onCancel = undefined,
    proceedLabel = "Proceed",
    cancelLabel = "Cancel",
  }: Props = $props();

  let percent = $derived(
    progress && progress.total > 0
      ? Math.round((100 * progress.done) / progress.total)
      : progress
        ? 0
        : 0,
  );
</script>

{#if open}
  <div
    class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60"
  >
    <div
      class="flex w-[34rem] max-w-[90vw] flex-col gap-4 bg-block p-6 text-icon shadow-xl"
    >
      <h2 class="text-2xl font-semibold">{title}</h2>

      {#if note}<p>{note}</p>{/if}

      {#if issues}
        <div class="max-h-60 overflow-auto bg-menu p-3 text-sm text-menu-text">
          {#if issues.length}
            <p class="mb-2 font-semibold">
              Before importing — the file needed some processing:
            </p>
            <ul class="list-disc pl-5">
              {#each issues as issue}<li>{issue}</li>{/each}
            </ul>
          {:else}
            <p>The file looks standard. Nothing needed cleaning.</p>
          {/if}
        </div>
      {/if}

      {#if progress}
        <div class="flex flex-col gap-1">
          <div class="h-3 w-full bg-menu">
            <div
              class="h-3 bg-green-500 transition-[width]"
              style="width: {percent}%"
            ></div>
          </div>
          <p class="text-sm">
            {progress.done.toLocaleString()} / {progress.total.toLocaleString()}
            ({percent}%)
          </p>
        </div>
      {/if}

      {#if onProceed || onCancel}
        <div class="flex justify-end gap-2">
          {#if onCancel}
            <button class="bg-button px-4 py-2" onclick={onCancel}
              >{cancelLabel}</button
            >
          {/if}
          {#if onProceed}
            <button class="bg-green-700 px-4 py-2 text-white" onclick={onProceed}
              >{proceedLabel}</button
            >
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}
