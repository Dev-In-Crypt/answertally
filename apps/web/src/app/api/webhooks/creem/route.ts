import { handlePaymentWebhook } from "@/server/payment-webhook";

/** Вебхук Creem — основного провайдера оплаты (Merchant of Record). */
export function POST(request: Request): Promise<Response> {
  return handlePaymentWebhook(request, "creem-signature", "creem");
}
