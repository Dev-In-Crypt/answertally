import { expect, test } from "@playwright/test";
import { runFreeAudit } from "./free-audit";

/** Verify T42: перевод действия в Done открывает диалог создания эксперимента. */

const CSV = [
  "cluster,intent,prompt,is_control",
  "CRM comparison,comparison,best CRM for startups,false",
].join("\n");

test("actions board moves cards and offers an experiment on completion", async ({ page }) => {
  const email = `board-${Math.random().toString(36).slice(2, 10)}@northwind-agency.test`;

  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Board Tester");
  await page.getByLabel("Agency name").fill("QA Agency");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // Клиент, которого нет в ответах — у него появятся рекомендации.
  await page.goto("/clients/new");
  await page.getByLabel("Client name").fill("Northwind CRM");
  await page.getByLabel("Domain").fill("northwind-crm.test");
  await page.getByLabel("Brand names").fill("Northwind CRM, Northwind");
  await page.getByLabel("Competitors").fill("Northstack, Pipewell, Clasp");
  await page.getByRole("button", { name: "Create client" }).click();
  // Заведение клиента ведёт на второй шаг онбординга, а не в список.
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}\/onboarding$/);
  await page.goto(page.url().replace(/\/onboarding$/, ""));
  const clientId = page.url().split("/").pop()!;

  // До действий доска показывает пустое состояние с объяснением, откуда они берутся.
  await page.goto(`/clients/${clientId}/actions`);
  await expect(page.getByText("No actions yet")).toBeVisible();

  await page.goto(`/clients/${clientId}/measure`);
  await page.getByLabel("Prompts CSV").setInputFiles({
    name: "prompts.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(CSV, "utf8"),
  });
  // Импорт асинхронный: без ожидания «Run now» иногда жмётся раньше, чем
  // промпты доедут до списка, и прогон отказывается стартовать.
  await expect(page.getByText(/Imported \d+ prompts/)).toBeVisible();
  await runFreeAudit(page);

  // Рекомендация превращается в действие.
  await page.goto(`/clients/${clientId}/diagnose`);
  await page.getByTestId("create-action").first().click();
  await expect(page.getByTestId("create-action").first()).toHaveText("Added to actions");

  await page.goto(`/clients/${clientId}/actions`);
  const backlog = page.getByTestId("column-backlog");
  await expect(backlog.locator("article")).toHaveCount(1);

  // Drawer показывает объяснение — то, что агентство перескажет клиенту.
  await backlog.locator("article button").first().click();
  const drawer = page.getByTestId("action-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByTestId("drawer-reason")).not.toBeEmpty();

  // Бриф: рекомендация развёрнута в задание, которое можно выполнить.
  const brief = drawer.getByTestId("action-brief");
  await expect(brief).toBeVisible();
  await expect(brief.getByTestId("brief-steps").locator("li").first()).not.toBeEmpty();
  // Без признака готовности задание нельзя закрыть, не споря о том, сделано ли оно.
  await expect(brief.getByTestId("brief-acceptance").locator("li").first()).not.toBeEmpty();
  // Числа измерения доехали до исполнителя, а не остались на экране диагностики.
  await expect(brief.getByTestId("brief-context")).toContainText("%");

  // Исполнитель назначается здесь же: работа без владельца стоит молча.
  await drawer.getByTestId("owner-select").selectOption({ index: 1 });
  await expect(page.getByTestId("column-backlog")).not.toContainText("unassigned");

  await drawer.getByRole("button", { name: "Close" }).click();

  // Перемещение в работу диалога не открывает.
  await page.getByRole("button", { name: "→ In progress" }).first().click();
  await expect(page.getByTestId("column-in_progress").locator("article")).toHaveCount(1);
  await expect(page.getByTestId("experiment-dialog")).toHaveCount(0);

  // Перевод в Done открывает предложение создать эксперимент.
  await page.getByRole("button", { name: "→ Done" }).first().click();
  await expect(page.getByTestId("experiment-dialog")).toBeVisible();
  await expect(page.getByTestId("experiment-dialog")).toContainText("baseline");

  // Эксперимент создаётся из диалога: baseline фиксируется в этот момент.
  await page.getByTestId("create-experiment").click();
  await expect(page.getByTestId("experiment-warnings")).toBeVisible();

  await page.getByRole("button", { name: /Not now|Close/ }).click();
  await expect(page.getByTestId("experiment-dialog")).toHaveCount(0);
  await expect(page.getByTestId("column-done").locator("article")).toHaveCount(1);

  // Статус пережил перезагрузку, а завершение попало в журнал.
  await page.reload();
  await expect(page.getByTestId("column-done").locator("article")).toHaveCount(1);

  // У закрытого действия виден результат — и он честно говорит, что нового
  // прогона после работы ещё не было, а не выдаёт молчание за отсутствие эффекта.
  await page.getByTestId("column-done").locator("article button").first().click();
  const doneDrawer = page.getByTestId("action-drawer");
  const outcome = doneDrawer.getByTestId("action-outcome");
  await expect(outcome).toBeVisible();
  await expect(outcome).toContainText("No answers citing this source have been measured");
  await expect(outcome).toContainText("evidence, not attribution of cause");
  await doneDrawer.getByRole("button", { name: "Close" }).click();

  await page.goto(`/clients/${clientId}`);
  await expect(page.getByTestId("activity-feed")).toContainText("Action completed");

  // Экран эксперимента: оценка, уверенность, дисклеймер, таймлайн и график.
  await page.goto(`/clients/${clientId}/experiments`);
  await expect(page.getByTestId("experiments-list").locator("li")).toHaveCount(1);

  const headline = page.getByTestId("estimate-headline");
  await expect(headline).toBeVisible();
  // Инвариант 2: цифра подаётся как оценка, а не как доказанный результат.
  await expect(headline).not.toContainText(/proven|proof|guaranteed|caused/i);

  await expect(page.getByTestId("confidence-badge")).toContainText(/Confidence: (low|medium|high)/);
  await expect(page.getByTestId("estimate-disclaimer")).toContainText("not attribution of cause");
  await expect(page.getByTestId("evidence-list").locator("li").first()).toBeVisible();
  await expect(page.getByTestId("experiment-timeline")).toContainText("Action shipped");
  await expect(page.getByTestId("experiment-chart")).toBeVisible();
});

test("an action can be dropped, but only with a reason", async ({ page }) => {
  const email = `drop-${Math.random().toString(36).slice(2, 10)}@northwind-agency.test`;

  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Drop Tester");
  await page.getByLabel("Agency name").fill("QA Agency");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/clients/new");
  await page.getByLabel("Client name").fill("AcmeCRM");
  await page.getByLabel("Domain").fill("acmecrm.test");
  await page.getByRole("button", { name: "Create client" }).click();
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}\/onboarding$/);
  await page.goto(page.url().replace(/\/onboarding$/, ""));
  const clientId = page.url().split("/").pop()!;

  // Не всё приходит из диагностики: агентство знает про клиента то, чего
  // нет в цитатах, и должно уметь завести работу руками.
  await page.goto(`/clients/${clientId}/actions`);
  await page.getByTestId("add-action").click();

  const form = page.getByTestId("new-action-dialog");
  await form.getByLabel("Title").fill("Pitch the trade outlet");

  // Без причины действие не создаётся: инвариант 7 держится и здесь.
  await expect(form.getByTestId("create-manual-action")).toBeDisabled();

  await form
    .getByLabel("Why this action exists")
    .fill("Editorial carries a third of the citations here.");
  await form.getByTestId("create-manual-action").click();

  const backlog = page.getByTestId("column-backlog");
  await expect(backlog.locator("article")).toHaveCount(1);

  await backlog.locator("article button").first().click();
  const drawer = page.getByTestId("action-drawer");

  // Без причины кнопка не работает: снятая молча задача вернётся снова.
  await expect(drawer.getByTestId("drop-action")).toBeDisabled();

  await drawer.getByTestId("drop-reason").fill("The client owns this outlet and will not pitch it.");
  await drawer.getByTestId("drop-action").click();

  await expect(backlog.locator("article")).toHaveCount(0);
  await expect(page.getByTestId("dropped-actions")).toContainText("1 dropped");
});
