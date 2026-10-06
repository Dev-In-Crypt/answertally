import { describe, expect, it } from "vitest";
import { fetchSiteSummary, homepageUrl, isPrivateAddress, summarizeHtml } from "./site-summary";

describe("site summary", () => {
  it("внутренние адреса не запрашиваются", async () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "172.20.0.5", "192.168.1.1", "169.254.169.254", "::1", "fd00::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
    expect(isPrivateAddress("93.184.216.34")).toBe(false);

    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response("<title>x</title>");
    }) as unknown as typeof fetch;
    expect(await fetchSiteSummary("http://127.0.0.1", fetchImpl)).toBeNull();
    expect(await fetchSiteSummary("localhost", fetchImpl)).toBeNull();
    expect(called).toBe(false);
  });

  it("берёт главную по домену в любом написании", () => {
    expect(homepageUrl("https://www.saucony.com/collections")?.href).toBe("https://www.saucony.com/");
    expect(homepageUrl("saucony.com")?.href).toBe("https://saucony.com/");
    expect(homepageUrl("")).toBeNull();
  });

  it("сводит страницу к тому, что сайт говорит о себе", () => {
    const summary = summarizeHtml(`
      <html><head><title>Saucony | Running Shoes</title>
      <meta name="description" content="Running shoes &amp; apparel for every runner.">
      <script>var noise = 1;</script></head>
      <body><nav><a href="/m">Men</a><a href="/t">Trail</a><a href="/s">Search</a></nav><h1>Run your world</h1><h2>Endorphin Speed 4</h2></body></html>`);
    expect(summary).toContain("Title: Saucony | Running Shoes");
    expect(summary).toContain("Running shoes & apparel");
    expect(summary).toContain("Endorphin Speed 4");
    expect(summary).toContain("Trail");
    expect(summary).not.toContain("noise");
    expect(summary).not.toContain("Search");
  });

  it("описание не обрывается на апострофе и берётся самое полное", () => {
    const summary = summarizeHtml(`
      <meta name="description" content="Glossier">
      <meta property="og:description" content="Glossier's beauty essentials: skincare and makeup for every day.">
      <script type="application/ld+json">{"@type":"Organization","description":"short"}</script>`);
    expect(summary).toContain("Glossier's beauty essentials: skincare and makeup for every day.");
  });
});
