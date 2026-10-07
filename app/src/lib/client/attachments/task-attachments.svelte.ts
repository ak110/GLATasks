import { createThumbnailManager } from "#lib/client/attachments/image-attachment-utils.svelte.ts";
import { extractImageFilesFromClipboard } from "#lib/client/attachments/attachment-utils.ts";
import { showErrorToast } from "#lib/client/ui/toast-store.svelte.ts";
import { extractErrorMessage } from "#lib/client/ui/extract-error-message.ts";

export function createTaskThumbnails(getIds: () => number[]) {
  const thumbnails = createThumbnailManager();
  const open = thumbnails.open;
  thumbnails.open = async (id: number) => {
    try {
      await open(id);
    } catch (error) {
      showErrorToast(extractErrorMessage(error));
    }
  };
  $effect(() => thumbnails.sync(getIds()));
  $effect(() => () => thumbnails.dispose());
  return thumbnails;
}

export function createAttachmentInput(onFiles: (files: File[]) => unknown) {
  let isDragOver = $state(false);
  return {
    get isDragOver() {
      return isDragOver;
    },
    ondragover(event: DragEvent) {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      isDragOver = true;
    },
    ondragleave() {
      isDragOver = false;
    },
    ondrop(event: DragEvent) {
      event.preventDefault();
      isDragOver = false;
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length > 0) return onFiles(files);
    },
    onpaste(event: ClipboardEvent) {
      const files = extractImageFilesFromClipboard(event);
      if (files.length === 0) return;
      event.preventDefault();
      return onFiles(files);
    },
  };
}
