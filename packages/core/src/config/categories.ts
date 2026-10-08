/**
 * Категории клиентов для общего индекса источников (решение фаундера 08.10.2026).
 *
 * Список, а не свободный текст: «CRM», «crm software» и «sales CRM» иначе
 * были бы тремя категориями, и порог в три агентства не набирался бы нигде.
 * Отрасль (`industry`) остаётся свободным полем — она идёт в генерацию
 * вопросов; категория — только в индекс.
 *
 * ponytail: короткий список; расширять по тому, что выбирают агентства.
 */
export const CLIENT_CATEGORIES = [
  { id: "crm-sales", label: "CRM and sales software" },
  { id: "marketing-software", label: "Marketing and SEO software" },
  { id: "analytics-software", label: "Analytics software" },
  { id: "project-management", label: "Project and work management" },
  { id: "scheduling-software", label: "Scheduling and booking software" },
  { id: "forms-surveys", label: "Forms and surveys" },
  { id: "developer-tools", label: "Developer tools and infrastructure" },
  { id: "security-privacy", label: "Security, privacy and VPN" },
  { id: "email-communication", label: "Email and communication" },
  { id: "hr-recruiting", label: "HR and recruiting" },
  { id: "finance-accounting", label: "Finance, accounting and payments" },
  { id: "personal-finance", label: "Personal finance and investing" },
  { id: "ecommerce-platforms", label: "E-commerce platforms" },
  { id: "education", label: "Education and courses" },
  { id: "healthcare", label: "Healthcare and clinics" },
  { id: "legal-services", label: "Legal services" },
  { id: "real-estate", label: "Real estate" },
  { id: "travel-hospitality", label: "Travel and hospitality" },
  { id: "home-bedding", label: "Home, bedding and furniture" },
  { id: "apparel-footwear", label: "Apparel and footwear" },
  { id: "beauty-personal-care", label: "Beauty and personal care" },
  { id: "food-beverage", label: "Food and beverage" },
  { id: "pets", label: "Pets" },
  { id: "fitness-wellness", label: "Fitness and wellness" },
  { id: "consumer-electronics", label: "Consumer electronics" },
  { id: "automotive", label: "Automotive" },
  { id: "agencies-services", label: "Agencies and professional services" },
  { id: "other", label: "Other" },
] as const;

export type ClientCategoryId = (typeof CLIENT_CATEGORIES)[number]["id"];

export const CLIENT_CATEGORY_IDS = CLIENT_CATEGORIES.map((c) => c.id) as [ClientCategoryId, ...ClientCategoryId[]];

/** Категория показывается, только когда в ней мерили хотя бы столько агентств (условия, раздел 5). */
export const CATEGORY_INDEX_MIN_WORKSPACES = 3;

/** Окно, за которое считаются цитаты индекса. */
export const CATEGORY_INDEX_WINDOW_DAYS = 90;

export function categoryLabel(id: string | null | undefined): string | null {
  return CLIENT_CATEGORIES.find((c) => c.id === id)?.label ?? null;
}
