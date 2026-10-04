import { handlePaymentWebhook } from "@/server/payment-webhook";

/** Вебхук Stripe — запасной провайдер, пока его ключи где-то настроены. */
export function POST(request: Request): Promise<Response> {
  return handlePaymentWebhook(request, "stripe-signature", "stripe");
}
