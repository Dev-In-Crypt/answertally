"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/root";

export const api = createTRPCReact<AppRouter>();

/** Типы ответов процедур: компоненты берут форму данных отсюда, а не переписывают её. */
export type RouterOutputs = inferRouterOutputs<AppRouter>;

export function TrpcProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }),
  );

  const [trpcClient] = useState(() =>
    api.createClient({
      // maxItems — тот же потолок, что у сервера (`maxBatchSize`): страница с
      // дюжиной запросов делится на два batch, а не получает отказ.
      links: [httpBatchLink({ url: "/api/trpc", transformer: superjson, maxItems: 10 })],
    }),
  );

  return (
    <api.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </api.Provider>
  );
}
