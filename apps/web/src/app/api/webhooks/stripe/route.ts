import { getPaymentEventLedger, getPaymentProvider } from "@/server/payments";
import { applyPaymentEvent } from "./apply";
import { db } from "@/server/db";

/**
 * Вебхук платёжного провайдера — единственный вход, который меняет права
 * агентства без участия человека.
 *
 * Тело читается сырым: подпись считается по байтам запроса, и любая
 * нормализация JSON её сломает. Неподтверждённая подпись — 400 и ничего
 * больше: без этой проверки план агентства мог бы выдать себе кто угодно.
 *
 * Коды ответа читает сам провайдер: 2xx — «доставлено, не повторять»,
 * 5xx — «повторить». Поэтому событие, которое мы сознательно не применяем,
 * отвечает 200, а сбой базы — 500.
 */

/**
 * Подключение создаётся внутри обработчика, а не на уровне модуля: сборка
 * образа выполняет модуль, чтобы собрать данные страницы, и подключение
 * на импорте делает сборку зависимой от рантайм-настроек.
 */
export async function POST(request: Request): Promise<Response> {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return Response.json({ error: "Missing signature" }, { status: 400 });
  }

  const payload = await request.text();

  let envelope;
  try {
    envelope = await getPaymentProvider().parseEvent(payload, signature);
  } catch (error) {
    console.error("[stripe] rejected webhook", error);
    return Response.json({ error: "Signature rejected" }, { status: 400 });
  }

  try {
    const result = await applyPaymentEvent(db, envelope, getPaymentEventLedger(db));

    if (result.status !== "applied") {
      // 200 намеренно: провайдер иначе будет слать это событие снова и снова.
      // В логе только тип и идентификатор события — ни карты, ни ключей.
      console.info(`[stripe] ${envelope.type} ${envelope.eventId} not applied: ${result.reason}`);
    }

    return Response.json({
      received: true,
      applied: result.status === "applied",
      status: result.status,
    });
  } catch (error) {
    // 500 — просьба повторить: событие отпущено, и повтор его применит.
    console.error("[stripe] failed to apply webhook", error);
    return Response.json({ error: "Could not apply the event" }, { status: 500 });
  }
}
