import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { createContext } from "@/server/trpc/context";
import { appRouter } from "@/server/trpc/root";
import { errorReporter } from "@/server/observability";

function handler(request: Request) {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: request,
    router: appRouter,
    createContext: () => createContext({ headers: request.headers }),
    // Без потолка один HTTP-запрос нёс тысячи вызовов, исполняемых
    // параллельно: так обходились проверки «посчитать — вставить» и
    // забивался пул подключений к базе. Клиент склеивает куда меньше.
    maxBatchSize: 10,
    onError({ error, path, type }) {
      // NOT_FOUND и UNAUTHORIZED — нормальная работа защиты тенанта (инвариант 1),
      // а не инцидент. Сообщать нужно о том, что сломалось на сервере.
      if (error.code !== "INTERNAL_SERVER_ERROR") return;

      errorReporter.captureError(error.cause ?? error, {
        scope: "trpc",
        path: path ?? "<unknown>",
        type,
      });
    },
  });
}

export { handler as GET, handler as POST };
