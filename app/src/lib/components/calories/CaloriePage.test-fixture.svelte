<script lang="ts">
    import {
        QueryClientProvider,
        type QueryClient,
    } from "@tanstack/svelte-query";
    import CaloriePage from "../../../routes/calories/+page.svelte";
    interface Props {
        client: QueryClient;
    }
    let { client }: Props = $props();
</script>

<QueryClientProvider {client}><CaloriePage /></QueryClientProvider>
