import { describe, expect, it } from "vitest";
import { competitorNameFromDomain } from "./competitor-name";

describe("competitorNameFromDomain", () => {
  it.each([
    ["hubspot.com", "Hubspot"],
    ["blog.hubspot.com", "Hubspot"],
    ["support.zendesk.com", "Zendesk"],
    ["docs.app.example.io", "Example"],
    ["acme.co.uk", "Acme"],
    ["help.acme.co.uk", "Acme"],
    // Домен, целиком из служебных слов, всё равно получает имя, а не пустую строку.
    ["app.com", "App"],
  ])("%s → %s", (domain, name) => {
    expect(competitorNameFromDomain(domain)).toBe(name);
  });
});
