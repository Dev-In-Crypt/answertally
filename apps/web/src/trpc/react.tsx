"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink, TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import superjson from "superjson";
import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/root";

export const api = createTRPCReact<AppRouter>();

/** Типы ответов процедур: компоненты берут форму данных отсюда, а не переписывают её. */
export type RouterOutputs = inferRouterOutputs<AppRouter>;

/**
 * Ответа сервера нет вовсе: сеть пропала или идёт выкладка, и прокси отдал
 * пустой 502. Без подмены на экране было бы «Unexpected end of JSON input».
 */
const CONNECTION_MESSAGE = "Connection problem. Check your connection and try again.";

let redirectingToLogin = false;

/**
 * Ошибки, общие для всех вызовов, разбираются здесь, а не в каждом экране.
 *
 * Сессия кончилась (истекла, пароль сброшен, участника удалили) — уводим на
 * вход один раз и с возвратом на текущую страницу. Иначе каждый экран
 * показывал бы ошибку с кнопкой «Try again», которая не может помочь:
 * мягкая навигация не перезапускает серверную проверку в `(app)/layout`.
 */
const errorLink: TRPCLink<AppRouter> = () => ({ next, op }) =>
  observable((observer) =>
    next(op).subscribe({
      next: (value) => observer.next(value),
      complete: () => observer.complete(),
      error: (error) => {
        if (error.data?.code === "UNAUTHORIZED" && !redirectingToLogin) {
          redirectingToLogin = true;
          const here = window.location.pathname + window.location.search;
          window.location.assign(`/login?next=${encodeURIComponent(here)}`);
        }
        observer.error(error.data ? error : new TRPCClientError(CONNECTION_MESSAGE, { cause: error }));
      },
    }),
  );

/** Повтор помогает от сбоя, а не от отказа: 4xx второй раз ответит так же. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  const status = error instanceof TRPCClientError ? (error.data?.httpStatus as number | undefined) : undefined;
  return failureCount < 1 && !(status && status < 500);
}

export function TrpcProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: shouldRetry } } }),
  );

  const [trpcClient] = useState(() =>
    api.createClient({
      // maxItems — тот же потолок, что у сервера (`maxBatchSize`): страница с
      // дюжиной запросов делится на два batch, а не получает отказ.
      links: [errorLink, httpBatchLink({ url: "/api/trpc", transformer: superjson, maxItems: 10 })],
    }),
  );

  return (
    <api.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </api.Provider>
  );
}
