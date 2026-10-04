import { createRequire } from "node:module";
import { resolve } from "node:path";

/**
 * Делает агентство пользователя платящим — прямой записью подписки в тестовую базу.
 *
 * Расписание без оплаты не сохраняется, а платёжного провайдера в e2e нет:
 * подписать вебхук нечем, и включать ключи ради этого значило бы сломать
 * проверку «оплата не подключена». Поэтому подписка пишется так, как её
 * записал бы обработчик события, — одной строкой.
 *
 * `postgres` — зависимость @repo/db, а не приложения; берём её оттуда.
 * Импорт @repo/db целиком сюда не подходит: его загрузчик .env на
 * import.meta, а Playwright грузит спеки как CJS.
 */
const requireFromDb = createRequire(resolve(__dirname, "../../../packages/db/package.json"));
type Sql = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
  end: () => Promise<void>;
};
const postgres = requireFromDb("postgres") as (url: string, options: { max: number }) => Sql;

export async function makeAgencyPaying(
  email: string,
  plan: "starter" | "growth" | "scale" = "starter",
): Promise<void> {
  const url = process.env["E2E_DATABASE_URL"];
  if (!url) {
    throw new Error("E2E_DATABASE_URL is not set — it comes from playwright.config.ts");
  }

  const sql = postgres(url, { max: 1 });
  try {
    const rows = await sql`
      insert into subscriptions (agency_id, provider, customer_id, plan, status, current_period_end)
      select agency_id, 'creem', ${`cus_e2e_${email}`}, ${plan}, 'active', now() + interval '30 days'
      from users where email = ${email.toLowerCase()}
      returning id`;
    if (rows.length !== 1) {
      throw new Error(`No user with email ${email} to make paying`);
    }
  } finally {
    await sql.end();
  }
}
