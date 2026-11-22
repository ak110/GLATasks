import { trpc, type RouterInputs } from "#lib/client/trpc.ts";
import { trackPendingWrite } from "#lib/client/ui/pending-writes.ts";

export const FILE_DROP_HIGHLIGHT_CLASSES =
  "bg-blue-50 ring-2 ring-blue-400 ring-inset dark:bg-blue-900/30 dark:ring-blue-500";

export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () =>
      reject(
        reader.error ??
          new Error(
            "ファイルの読み込みに失敗しました。ファイルを選び直して添付をやり直してください",
          ),
      );
    reader.readAsDataURL(file);
  });
}

export function uploadAttachment(
  taskId: RouterInputs["attachments"]["create"]["taskId"],
  file: File,
): Promise<void> {
  return trackPendingWrite(async () => {
    const data = await readFileAsBase64(file);
    await trpc.attachments.create.mutate({
      taskId,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      data,
    });
  });
}

export function isImageAttachment(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

let clipboardSequence = 0;
let clipboardSequenceKey = "";

export function extractImageFilesFromClipboard(event: ClipboardEvent): File[] {
  const items = event.clipboardData?.files;
  if (!items || items.length === 0) return [];
  const results: File[] = [];
  for (const file of Array.from(items)) {
    if (!isImageAttachment(file.type)) continue;
    if (file.name) {
      results.push(file);
      continue;
    }
    results.push(renameClipboardFile(file));
  }
  return results;
}

function renameClipboardFile(file: File): File {
  const ext = file.type.split("/")[1] ?? "bin";
  const now = new Date();
  const yyyymmdd =
    `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}` +
    `${String(now.getDate()).padStart(2, "0")}`;
  const hhmmss =
    `${String(now.getHours()).padStart(2, "0")}` +
    `${String(now.getMinutes()).padStart(2, "0")}` +
    `${String(now.getSeconds()).padStart(2, "0")}`;
  const key = `${yyyymmdd}-${hhmmss}`;
  if (clipboardSequenceKey !== key) {
    clipboardSequenceKey = key;
    clipboardSequence = 0;
  }
  clipboardSequence += 1;
  const seq = String(clipboardSequence).padStart(3, "0");
  const name = `clipboard-${key}-${seq}.${ext}`;
  return new File([file], name, { type: file.type });
}
