import { createLogger, type LogFields, type Logger } from "../observability/logger";
import type { EmailMessage, EmailSender, SentEmail } from "./types";

/**
 * Отправитель, который ничего не отправляет.
 *
 * Это рабочий режим по умолчанию, а не заглушка на время: без ключа продукт
 * обязан оставаться пригодным — приглашение и сброс пароля работают по ссылке,
 * которую интерфейс показывает сам. Письма складываются в память, чтобы их
 * можно было увидеть в тестах и в логе разработки.
 */

/** Сколько писем держать в памяти: режим работает месяцами, список расти вечно не может. */
const DEFAULT_LIMIT = 200;

export class MemoryEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];
  private counter = 0;
  private readonly limit: number;

  constructor(
    private readonly log: ((message: EmailMessage) => void) | null = null,
    limit: number = DEFAULT_LIMIT,
  ) {
    this.limit = Math.max(1, limit);
  }

  send(message: EmailMessage): Promise<SentEmail> {
    this.counter += 1;
    this.sent.push(message);
    // Старые письма вытесняются: нужен хвост, а не вся история процесса.
    if (this.sent.length > this.limit) this.sent.splice(0, this.sent.length - this.limit);
    this.log?.(message);
    return Promise.resolve({ id: `memory-${this.counter}`, logged: true });
  }

  /** Последнее письмо адресату — этим пользуются тесты. */
  lastTo(email: string): EmailMessage | undefined {
    return [...this.sent].reverse().find((message) => message.to === email);
  }

  clear(): void {
    this.sent.length = 0;
  }
}

/**
 * Конверт письма: всё, по чему его можно опознать, и ничего из содержимого.
 */
export function emailEnvelopeFields(message: EmailMessage): LogFields {
  return {
    to: message.to,
    subject: message.subject,
    fromName: message.fromName,
    replyTo: message.replyTo,
  };
}

/**
 * Поля письма для режима без транспорта.
 *
 * Тело кладётся целиком — но только здесь: без транспорта лог единственное
 * место, где остаётся ссылка на приглашение и на смену пароля. Другого канала
 * для неё нет, и терять её нельзя.
 */
export function emailLogFields(message: EmailMessage): LogFields {
  return {
    ...emailEnvelopeFields(message),
    // Разметка в лог не идёт: читать её некому, а строку она раздувает.
    htmlBytes: message.html ? message.html.length : undefined,
    body: message.text,
  };
}

/** Запись письма поверх переданного логгера — так её подменяют в тестах. */
export function createEmailLog(logger: Logger): (message: EmailMessage) => void {
  return (message) => {
    logger.info("email.logged", emailLogFields(message));
  };
}

/**
 * Письмо, которое транспорт так и не принял.
 *
 * Тела здесь нет намеренно. В живом режиме письмо содержит ссылку на смену
 * пароля и ссылку `/r/<токен>`, открывающую отчёт клиента без входа; эти
 * строки не должны лежать в логе, который собирает хостинг и куда смотрит
 * внешний сборщик ошибок. Отказ доставки лечится повторной отправкой в один
 * клик, а утёкший токен — нет. Для разбора хватает адресата, темы и причины:
 * число попыток уже стоит в тексте ошибки.
 */
export function createEmailFailureLog(
  logger: Logger,
): (message: EmailMessage, error: Error) => void {
  return (message, error) => {
    logger.error("email.failed", { ...emailEnvelopeFields(message), error });
  };
}

/** Ошибки — в stderr, остальное — в stdout: так же, как у логов web. */
function consoleLogger(): Logger {
  return createLogger({
    sink: (line, level) => {
      if (level === "warn" || level === "error") process.stderr.write(`${line}\n`);
      else process.stdout.write(`${line}\n`);
    },
    base: { service: "email" },
  });
}

/**
 * Пишет письмо целиком одной структурной строкой: разбирать свободный текст
 * грепом через полгода — отдельная работа (тот же довод, что у логов воркера).
 */
export const consoleEmailLog: (message: EmailMessage) => void = createEmailLog(consoleLogger());

export const consoleEmailFailureLog: (message: EmailMessage, error: Error) => void =
  createEmailFailureLog(consoleLogger());
