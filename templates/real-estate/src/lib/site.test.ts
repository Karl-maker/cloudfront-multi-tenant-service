import {
  allPages,
  getFooterLinks,
  getFooterSocialLinks,
  getNavigationCta,
  getNavigationLinks,
  isConfiguredHref,
  normalizeInternalHref,
  siteConfig
} from "@/lib/site";

describe("site config resolution", () => {
  it("expands reusable default section blocks into pages", () => {
    const faq = allPages.find((page) => page.path === "/faq/");
    const contact = allPages.find((page) => page.path === "/contact/");

    expect(faq?.sections.some((section) => section.type === "faq" && section.id === "faq")).toBe(true);
    expect(contact?.sections.some((section) => section.type === "contact" && section.id === "contact-options")).toBe(true);
  });

  it("keeps configured internal routes and generated metadata files valid", () => {
    expect(isConfiguredHref("/")).toBe(true);
    expect(isConfiguredHref("/services/")).toBe(true);
    expect(isConfiguredHref("/availabilities/")).toBe(true);
    expect(isConfiguredHref("/services/property-acquisition/")).toBe(true);
    expect(isConfiguredHref("/services/transaction-coordination/")).toBe(true);
    expect(isConfiguredHref("/faq/")).toBe(true);
    expect(isConfiguredHref("/contact/")).toBe(true);
    expect(isConfiguredHref("/#services")).toBe(true);
    expect(isConfiguredHref("/llms.txt")).toBe(true);
    expect(isConfiguredHref("/manifest.webmanifest")).toBe(true);
  });

  it("rejects links to pages or anchors that are not configured", () => {
    expect(isConfiguredHref("/pricing/")).toBe(false);
    expect(isConfiguredHref("/#missing-section")).toBe(false);
    expect(isConfiguredHref("/not-a-page/")).toBe(false);
  });

  it("normalizes page links while preserving anchors and generated files", () => {
    expect(normalizeInternalHref("/about")).toBe("/about/");
    expect(normalizeInternalHref("/#services")).toBe("/#services");
    expect(normalizeInternalHref("/llms.txt")).toBe("/llms.txt");
    expect(normalizeInternalHref("mailto:hello@example-realestate.com")).toBe(
      "mailto:hello@example-realestate.com"
    );
  });

  it("filters header navigation and CTA to configured targets only", () => {
    const pagePaths = new Set(allPages.map((page) => page.path));

    expect(getNavigationLinks()).toEqual(
      siteConfig.navigation.links.filter((link) => isConfiguredHref(link.href))
    );
    expect(getNavigationLinks().every((link) => isConfiguredHref(link.href))).toBe(true);
    expect(pagePaths.has("/offline/")).toBe(true);
    expect(getNavigationLinks().some((link) => link.href === "/offline/")).toBe(false);
    expect(getNavigationLinks().map((link) => link.href)).toEqual([
      "/",
      "/availabilities/",
      "/services/",
      "/about/",
      "/rates/",
      "/amenities/",
      "/location/",
      "/faq/",
      "/contact/"
    ]);
    expect(getNavigationCta()?.href).toBe("/contact/");
  });

  it("returns footer social links only from configured entries", () => {
    expect(getFooterSocialLinks()).toEqual(siteConfig.footer.socialLinks);
    expect(getFooterSocialLinks().map((link) => link.platform)).toEqual([
      "instagram",
      "youtube",
      "facebook",
      "tiktok"
    ]);
  });

  it("includes default policy pages and footer links", () => {
    expect(allPages.map((page) => page.path)).toEqual(
      expect.arrayContaining(["/privacy/", "/terms/", "/cookies/"])
    );
    expect(getFooterLinks().map((link) => link.href)).toEqual(
      expect.arrayContaining([
        "/availabilities/",
        "/services/",
        "/rates/",
        "/amenities/",
        "/location/",
        "/faq/",
        "/privacy/",
        "/terms/",
        "/cookies/"
      ])
    );
  });
});
