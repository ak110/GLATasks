import { checkConnectivity } from "#lib/client/sse/connection-recovery.svelte.ts";

export async function shouldNotifyFailure(): Promise<boolean> {
  return (await checkConnectivity()) !== "intercepted";
}
