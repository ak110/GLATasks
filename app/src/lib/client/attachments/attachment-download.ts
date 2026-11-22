import { base64ToBytes } from "#lib/base64.ts";
import { trpc } from "#lib/client/trpc.ts";

export async function downloadAttachment(attachmentId: number): Promise<void> {
  const { filename, mimeType, data } = await trpc.attachments.download.query({
    attachmentId,
  });

  const bytes = base64ToBytes(data);
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
