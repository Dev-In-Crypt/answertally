import type { ActionType } from "../diagnosis/recommendations";

/**
 * Плейбуки: повторяемые рецепты по типам работ.
 *
 * Смысл продукта — «без роста команды»: работа на десяти клиентах отличается
 * не творчеством, а объёмом. Один раз описанный рецепт переиспользуется у всех,
 * и именно это экономит те 8–12 часов в месяц, ради которых агентство платит.
 *
 * Шаги описывают процесс, а не результат: попадание в источник зависит от
 * редакции, модераторов и удачи, и обещать его в шагах было бы враньём
 * (инвариант 2). Ничего никуда не публикуется — это документ для человека
 * (инвариант 4), и текст страницы за агентство здесь не пишется (инвариант 5).
 */

export interface Playbook {
  /** Что считается сделанным — проверяемо глазами, без нашего участия. */
  acceptance: string[];
  steps: string[];
  /** Ошибки, которые дороже всего стоят. Необязательны. */
  pitfalls?: string[];
}

export const PLAYBOOKS: Record<ActionType, Playbook> = {
  review_platform: {
    steps: [
      "Claim or create the vendor profile and complete every field the platform scores: categories, pricing, integrations, screenshots.",
      "Pick the categories the buyer questions actually match, not the widest ones available.",
      "Ask recent customers for reviews through the platform's own invitation flow, so they are marked as verified.",
      "Fill the comparison fields the platform uses to build its own round-ups.",
    ],
    acceptance: [
      "The profile is live and public, with categories set and pricing visible.",
      "At least a handful of verified reviews are published, not pending.",
      "The client appears in the platform's category listing when browsed as a visitor.",
    ],
    pitfalls: [
      "A half-filled profile is often skipped by the platform's own listicles.",
      "Bulk-requested reviews arriving on one day tend to be held back by moderation.",
    ],
  },

  pr_editorial: {
    steps: [
      "Find the specific articles on the source that already cover this topic and note their authors and angles.",
      "Prepare one concrete, checkable fact the client can contribute: original data, a customer outcome with numbers, or a technical detail nobody else publishes.",
      "Pitch that fact to the author whose existing article it fits, not to a generic editorial address.",
      "Offer an interview slot or a data extract; keep the ask to one paragraph.",
    ],
    acceptance: [
      "A named editor or author has the pitch and has replied, even if the reply is no.",
      "If accepted: the published piece names the client and is publicly reachable.",
    ],
    pitfalls: [
      "Generic product pitches without a fact of their own are the most common rejection.",
      "Editorial timelines run in weeks; treat a month of silence as normal, not as failure.",
    ],
  },

  source_outreach: {
    steps: [
      "Read the directory's inclusion rules and note what disqualifies a listing.",
      "Prepare the assets it asks for: description within the length limit, logo, categories, pricing tier.",
      "Submit through the official form and record the submission date.",
      "Follow up once after the stated review window, not before.",
    ],
    acceptance: [
      "The submission is confirmed and its status is visible or acknowledged.",
      "Once approved: the listing is reachable and the client is named on it.",
    ],
    pitfalls: ["Resubmitting before the review window usually resets the queue position."],
  },

  ugc_community: {
    steps: [
      "Read the community rules on self-promotion before posting anything.",
      "Find the existing threads where the buyer question is asked and competitors are named.",
      "Answer the question on its merits, disclosing the affiliation plainly.",
      "Keep participating where the client's expertise is genuinely useful, not only where the brand fits.",
    ],
    acceptance: [
      "The contribution is posted, discloses the affiliation and has not been removed by moderators.",
      "It answers the question a reader arrived with, on its own.",
    ],
    pitfalls: [
      "Undisclosed promotion gets accounts banned and the domain filtered, and the damage outlives the post.",
      "You cannot buy your way into a community; participation is the only route.",
    ],
  },

  create_page: {
    steps: [
      "Take the buyer questions from this cluster and list what an answer must contain to be usable without leaving the page.",
      "Write the page so each question is answered directly, with specifics an assistant can quote: numbers, limits, prices, supported cases.",
      "Name the alternatives honestly where the comparison is what the reader came for.",
      "Publish it on the client's own domain and link it from the pages that already get traffic.",
    ],
    acceptance: [
      "The page is live on the client's domain and reachable without login.",
      "Every question in the cluster has a direct answer on it, not a link elsewhere.",
      "The brand name appears in the parts that answer the question, not only in the header.",
    ],
    pitfalls: [
      "A page that only describes the product answers a different question than the one being asked.",
    ],
  },

  refresh_page: {
    steps: [
      "Open the page as the assistant reads it: strip navigation and look at what the text actually states.",
      "Check whether the brand is named inside the passages that answer the question, or only in the layout around them.",
      "Update prices, limits and dates that have gone stale. Outdated specifics are why a page gets read and then ignored.",
      "Add the missing specifics the cluster's questions ask for.",
    ],
    acceptance: [
      "The page names the brand within the answering passages.",
      "Prices, limits and dates on it match reality today.",
    ],
    pitfalls: ["Rewriting the whole page hides which change mattered when the next run comes in."],
  },

  technical_fix: {
    steps: [
      "Reproduce what a crawler receives: fetch the page without JavaScript and compare with what a visitor sees.",
      "Fix the specific barrier found: server errors, redirect chains, content that only exists after client-side rendering.",
      "Re-fetch and confirm the answering text is present in the raw response.",
    ],
    acceptance: [
      "The page returns a success status and the answering content is in the raw HTML.",
    ],
  },

  structured_data_fix: {
    steps: [
      "Check which schema types the page should carry for its purpose: product, pricing, FAQ, organization.",
      "Add or correct the markup so it states the same facts as the visible text.",
      "Validate the markup with the vendor's own testing tool and fix reported errors.",
    ],
    acceptance: [
      "The markup validates without errors and matches what the page says on screen.",
    ],
    pitfalls: ["Markup that contradicts the visible text is worse than no markup at all."],
  },

  crawler_fix: {
    steps: [
      "Read robots.txt and the meta directives on the page for rules that block assistant crawlers specifically.",
      "Decide with the client which crawlers should be allowed. This is their call, not ours.",
      "Apply the change and confirm with a fetch that the page is now allowed.",
    ],
    acceptance: [
      "The intended crawlers are allowed, and the decision is recorded with the client's agreement.",
    ],
  },

  product_data_update: {
    steps: [
      "Collect the product facts that appear across listings and feeds: pricing tiers, limits, integrations, availability.",
      "Correct them at the source the client controls, then in every listing that repeats them.",
      "Note where a listing cannot be edited directly and who to contact for it.",
    ],
    acceptance: [
      "The client-controlled source states the current facts.",
      "Third-party listings either match it or are logged as pending with a contact.",
    ],
    pitfalls: ["Stale pricing repeated across directories is quoted back for months."],
  },
};

export function playbookFor(actionType: ActionType): Playbook {
  return PLAYBOOKS[actionType];
}
