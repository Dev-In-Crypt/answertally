/**
 * Общий транспорт живых адаптеров: POST с JSON, повтором и таймаутом.
 *
 * Первые три адаптера писали этот цикл каждый по-своему, и статус ошибки в
 * них восстанавливался разбором строки сообщения. Здесь он хранится в самой
 * ошибке. Новые адаптеры пользуются этим файлом; старые не тронуты — они
 * проверены живыми вызовами, а переписывать проверенное ради единообразия
 * значит платить риском за красоту.
 *
 * Сеть трогается только через переданный `fetchImpl`: в тестах он подменяется.
 */

/** Статусы, на которых повтор имеет смысл: сбой на стороне провайдера или лимит. */
export const DEFAULT_RETRYABLE_STATUSES: ReadonlySet<number> = new Set([
  408, 409, 429, 500, 502, 503, 504,
]);

export class ProviderHttpError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
    detail: string,
  ) {
    super(`${provider} responded ${status}: ${detail}`);
    this.name = "ProviderHttpError";
  }
}

export interface PostJsonOptions {
  provider: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  fetchImpl: typeof fetch;
  maxAttempts: number;
  sleep: (ms: number) => Promise<void>;
  timeoutMs: number;
  retryableStatuses?: ReadonlySet<number>;
}

export function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function postJson<T>(options: PostJsonOptions): Promise<T> {
  const retryable = options.retryableStatuses ?? DEFAULT_RETRYABLE_STATUSES;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      const response = await options.fetchImpl(options.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...options.headers },
        body: options.body,
        signal: AbortSignal.timeout(options.timeoutMs),
      });

      if (response.ok) {
        return (await response.json()) as T;
      }

      const error = new ProviderHttpError(
        options.provider,
        response.status,
        (await response.text()).slice(0, 500),
      );

      // 4xx кроме перечисленных — наша ошибка: повтор даст тот же ответ.
      if (!retryable.has(response.status)) {
        throw error;
      }
      lastError = error;
    } catch (error) {
      if (error instanceof ProviderHttpError && !retryable.has(error.status)) {
        throw error;
      }
      lastError = error instanceof Error ? error : new Error(String(error));
    }

    if (attempt < options.maxAttempts) {
      await options.sleep(2 ** (attempt - 1) * 1000);
    }
  }

  throw lastError ?? new Error(`${options.provider} request failed`);
}

/**
 * Потолки одного ответа ассистента — для каждого адаптера.
 *
 * Текст вопроса задаёт агентство, а в нём можно попросить «сделай тридцать
 * поисков и напиши двадцать тысяч слов». Без потолков такой ответ стоил в
 * десятки раз дороже обычного, а продукт работал бы бесплатным прокси к
 * ассистентам за наш счёт. Главная статья расхода — поиски (у OpenAI $10 за
 * тысячу), поэтому их потолок важнее потолка токенов; тот взят с запасом,
 * чтобы рассуждение модели не обрезало обычный ответ.
 */
export const MAX_ANSWER_OUTPUT_TOKENS = 8000;

/**
 * У OpenAI в потолок ответа входят и токены рассуждения: при 8000 длинное
 * рассуждение съедало весь бюджет, и оплаченный ответ приходил пустым.
 * Выход у gpt-6-luna — $0.5 за миллион, так что 16k — меньше цента.
 */
export const MAX_OPENAI_OUTPUT_TOKENS = 16000;
export const MAX_SEARCHES_PER_ANSWER = 5;

