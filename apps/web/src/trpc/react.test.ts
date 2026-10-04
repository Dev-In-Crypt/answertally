import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { describe, expect, it } from "vitest";
import type { AppRouter } from "@/server/trpc/root";
import { errorLink } from "./react";

/**
 * Сбой связи на экране — одной человеческой фразой, а не «Failed to fetch»
 * или «Unexpected end of JSON input». Ответ сервера с ошибкой tRPC проходит
 * как есть: его текст уже собран errorFormatter-ом.
 */
function clientWith(fetchImpl: () => Promise<Response>) {
  return createTRPCClient<AppRouter>({
    links: [
      errorLink,
      httpBatchLink({ url: "http://test/api/trpc", transformer: superjson, fetch: fetchImpl }),
    ],
  });
}

const query = (fetchImpl: () => Promise<Response>) =>
  clientWith(fetchImpl).clients.get.query({ id: "00000000-0000-0000-0000-000000000000" });

const CONNECTION = "Connection problem. Check your connection and try again.";

describe("errorLink: сбой связи — понятной фразой", () => {
  it("сеть пропала (TypeError: Failed to fetch)", async () => {
    await expect(query(() => Promise.reject(new TypeError("Failed to fetch")))).rejects.toThrow(
      CONNECTION,
    );
  });

  it("прокси отдал не-JSON (пустой 502, HTML-страница)", async () => {
    await expect(query(async () => new Response("", { status: 502 }))).rejects.toThrow(CONNECTION);
    await expect(
      query(async () => new Response("<html>Bad gateway</html>", { status: 502 })),
    ).rejects.toThrow(CONNECTION);
  });

  it("ошибка tRPC от сервера проходит со своим текстом и кодом", async () => {
    const shape = {
      message: "Client not found.",
      code: -32004,
      data: { code: "NOT_FOUND", httpStatus: 404 },
    };
    const body = JSON.stringify([{ error: superjson.serialize(shape) }]);
    const failure = (await query(async () => new Response(body, { status: 404 })).then(
      () => null,
      (error: unknown) => error,
    )) as { message: string; data?: { code?: string } };
    expect(failure.message).toBe("Client not found.");
    expect(failure.data?.code).toBe("NOT_FOUND");
  });
});
