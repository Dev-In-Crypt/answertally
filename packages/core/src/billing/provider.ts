import { UnconfiguredPaymentProvider, type PaymentProvider } from "./payments";
import { CreemPaymentProvider, type CreemProducts } from "./creem";
import { StripePaymentProvider, type StripePrices } from "./stripe";

/**
 * Выбор платёжного провайдера — по тому же правилу, что адаптеры и почта:
 * без ключей продукт работает и честно говорит, что оплату не принимает.
 */
export function createPaymentProvider(env: NodeJS.ProcessEnv = process.env): PaymentProvider {
  // Creem — основной провайдер (Merchant of Record); Stripe остаётся
  // запасным путём, пока его ключи где-то настроены.
  const creemKey = env["CREEM_API_KEY"]?.trim();
  if (creemKey) {
    return createCreemProvider(creemKey, env);
  }

  const secretKey = env["STRIPE_SECRET_KEY"]?.trim();
  if (!secretKey) {
    return new UnconfiguredPaymentProvider();
  }

  const webhookSecret = env["STRIPE_WEBHOOK_SECRET"]?.trim();
  if (!webhookSecret) {
    throw new Error(
      "STRIPE_SECRET_KEY is set without STRIPE_WEBHOOK_SECRET. Without it a subscription change cannot be trusted.",
    );
  }

  const prices: StripePrices = {
    starter: env["STRIPE_PRICE_STARTER"]?.trim() ?? "",
    growth: env["STRIPE_PRICE_GROWTH"]?.trim() ?? "",
    scale: env["STRIPE_PRICE_SCALE"]?.trim() ?? "",
  };

  const missing = (Object.entries(prices) as [string, string][])
    .filter(([, value]) => !value)
    .map(([plan]) => plan);
  if (missing.length > 0) {
    // Половина настроенных планов хуже, чем ни одного: агентство упрётся в
    // ошибку уже после того, как решило заплатить.
    throw new Error(`Stripe price IDs are missing for: ${missing.join(", ")}.`);
  }

  return new StripePaymentProvider({ secretKey, webhookSecret, prices });
}

function createCreemProvider(apiKey: string, env: NodeJS.ProcessEnv): PaymentProvider {
  const webhookSecret = env["CREEM_WEBHOOK_SECRET"]?.trim();
  if (!webhookSecret) {
    throw new Error(
      "CREEM_API_KEY is set without CREEM_WEBHOOK_SECRET. Without it a subscription change cannot be trusted.",
    );
  }

  const products: CreemProducts = {
    starter: env["CREEM_PRODUCT_STARTER"]?.trim() ?? "",
    growth: env["CREEM_PRODUCT_GROWTH"]?.trim() ?? "",
    scale: env["CREEM_PRODUCT_SCALE"]?.trim() ?? "",
  };
  const missing = (Object.entries(products) as [string, string][])
    .filter(([, value]) => !value)
    .map(([plan]) => plan);
  if (missing.length > 0) {
    throw new Error(`Creem product IDs are missing for: ${missing.join(", ")}.`);
  }

  return new CreemPaymentProvider({ apiKey, webhookSecret, products });
}

