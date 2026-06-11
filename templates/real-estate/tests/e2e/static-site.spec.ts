import { expect, test } from "@playwright/test";

test.describe("static site template", () => {
  test("renders the home layout without horizontal overflow", async ({ page }, testInfo) => {
    await page.goto("/");

    await expect(page.getByRole("complementary", { name: "Trial site notice" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Check us out" })).toHaveAttribute("href", "https://www.syncpoly.com");
    await expect(page.getByRole("img", { name: "SyncPoly icon" })).toHaveAttribute(
      "src",
      "https://d1mp8fjhswh27j.cloudfront.net/assets/syncpoly-icon.png"
    );
    await expect(page.getByRole("heading", { name: "All your real estate needs under one roof." })).toBeVisible();
    await expect(page.locator("#hero").getByRole("link", { name: "View Availabilities" })).toBeVisible();
    await expect(page.locator("#hero").getByRole("region", { name: "Featured property imagery" })).toHaveCount(0);
    await expect(page.locator(".site-header")).toHaveClass(/site-header--at-top/);

    const topHeaderStyle = await page.locator(".site-header").evaluate((header) => {
      const styles = getComputedStyle(header);
      return {
        background: styles.backgroundColor,
        position: styles.position
      };
    });
    expect(topHeaderStyle.background).toBe("rgba(0, 0, 0, 0)");
    expect(topHeaderStyle.position).toBe("absolute");

    const heroStatColors = await page.locator("#hero .hero-stats dt, #hero .hero-stats dd").evaluateAll((nodes) => [
      ...new Set(nodes.map((node) => getComputedStyle(node).color))
    ]);
    expect(heroStatColors).toEqual(["rgb(255, 255, 255)"]);

    await page.locator("#featured-gallery").scrollIntoViewIfNeeded();
    await expect(page.getByRole("heading", { name: "Property imagery with room to breathe." })).toBeVisible();
    await expect(page.getByRole("region", { name: "Featured property imagery" })).toBeVisible();
    await expect(page.getByRole("img", { name: "Bright residential property exterior with landscaped entry" })).toBeVisible();
    await page.getByRole("button", { name: "Next image" }).click();
    await expect(page.getByRole("img", { name: "Contemporary home exterior with glass and timber details" })).toBeVisible();

    if (testInfo.project.name === "mobile") {
      await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible();
      await page.getByRole("button", { name: "Open menu" }).click();
    }

    await page.evaluate(() => window.scrollTo(0, 420));
    await expect(page.locator(".site-header")).not.toHaveClass(/site-header--at-top/);

    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );
    expect(hasOverflow).toBe(false);
  });

  test("navigation links only point at configured targets", async ({ page }, testInfo) => {
    await page.goto("/");

    if (testInfo.project.name === "mobile") {
      await page.getByRole("button", { name: "Open menu" }).click();
    }

    await expect(page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Services" })).toBeVisible();

    const hrefs = await page.locator("header a").evaluateAll((links) =>
      links.map((link) => link.getAttribute("href")).filter(Boolean)
    );

    expect(hrefs).toContain("/");
    expect(hrefs).toContain("/about/");
    expect(hrefs).toContain("/contact/");
    expect(hrefs).toContain("/services/");
    expect(hrefs).toContain("/availabilities/");
    expect(hrefs).toContain("/rates/");
    expect(hrefs).toContain("/amenities/");
    expect(hrefs).toContain("/location/");
    expect(hrefs).toContain("/faq/");
    expect(hrefs).not.toContain("/offline/");
  });

  test("header navigation adapts across viewports", async ({ page }, testInfo) => {
    await page.goto("/");

    const headerCta = page.locator("header").getByRole("link", { name: "Contact Us" });
    const menuButton = page.getByRole("button", { name: "Open menu" });

    if (testInfo.project.name !== "mobile") {
      await expect(menuButton).toBeHidden();
      await expect(headerCta).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Services" })).toBeVisible();
      return;
    }

    await expect(headerCta).toBeHidden();
    await expect(menuButton).toHaveAttribute("aria-expanded", "false");

    await menuButton.click();

    await expect(page.getByRole("button", { name: "Close menu" })).toHaveAttribute("aria-expanded", "true");
    await expect(headerCta).toBeVisible();

    await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Services" }).click();

    await expect(page.getByRole("button", { name: "Open menu" })).toHaveAttribute("aria-expanded", "false");
    await expect(page).toHaveURL(/\/services\/$/);
  });

  test("exports configured multi-page routes", async ({ page }) => {
    for (const route of [
      "/availabilities/",
      "/services/",
      "/services/property-acquisition/",
      "/services/transaction-coordination/",
      "/rates/",
      "/amenities/",
      "/location/",
      "/faq/"
    ]) {
      await page.goto(route);
      await expect(page.locator("h1").first()).toBeVisible();
    }
  });

  test("rates, amenities, location, video, and nested FAQ sections render", async ({ page }) => {
    await page.goto("/rates/");
    await expect(page.getByRole("heading", { name: "Start with the structure that fits." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Property Marketing" })).toBeVisible();
    await expect(page.getByText("Custom").first()).toBeVisible();

    await page.goto("/amenities/");
    await expect(page.getByRole("heading", { name: "Configured for the details clients compare." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Parking" })).toBeVisible();
    await expect(page.getByLabel("Placeholder property video")).toBeVisible();
    await expect(page.getByRole("region", { name: "Amenities media gallery" })).toBeVisible();

    await page.goto("/location/");
    await expect(page.getByRole("heading", { name: "Office and service area" })).toBeVisible();
    await expect(page.getByTitle("Aurum Realty Group location map")).toBeVisible();
    await expect(page.getByText("4 De Verteuil St, Woodbrook", { exact: true })).toBeVisible();

    await page.goto("/faq/");
    await page
      .locator("#faq summary")
      .filter({ hasText: "Do you support both residential and commercial property?" })
      .click();
    await expect(page.getByText("Can each service or property have its own page?")).toBeVisible();
  });

  test("services, testimonials, and contact CTAs render", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Integrated service from search to signature." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Property Acquisition" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Trust is built in the details." })).toBeVisible();
    await expect(page.locator("#contact-cta").getByRole("link", { name: "Contact Us" })).toBeVisible();
  });

  test("contact page renders default contact content", async ({ page }) => {
    await page.goto("/contact/");

    await expect(page.getByRole("heading", { name: "Start the property conversation" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Phone")).toBeVisible();
    await expect(page.getByLabel("Property need")).toBeVisible();
    await expect(page.getByLabel("Preferred location")).toBeVisible();
    await expect(page.getByLabel("Budget or target value")).toBeVisible();
    await expect(page.getByLabel("Property details")).toBeVisible();
    await expect(page.getByText("4 De Verteuil St, Woodbrook, Port of Spain, Trinidad & Tobago")).toBeVisible();
    await expect(page.getByRole("form", { name: "Start the property conversation form" })).toHaveAttribute(
      "action",
      "mailto:hello@example-realestate.com"
    );
    await expect(page.getByRole("form", { name: "Start the property conversation form" })).toHaveAttribute(
      "enctype",
      "text/plain"
    );
    await expect(page.getByRole("button", { name: "Send Inquiry" })).toBeVisible();

    const formAction = await page.getByRole("form", { name: "Start the property conversation form" }).evaluate((form) => {
      return form instanceof HTMLFormElement ? form.action : "";
    });
    expect(formAction).toBe("mailto:hello@example-realestate.com");
  });

  test("footer social links render only when configured", async ({ page }) => {
    await page.goto("/");

    const socialNav = page.getByRole("navigation", { name: "Social media links" });
    await expect(socialNav).toBeVisible();
    await expect(socialNav.getByRole("link", { name: "Facebook" })).toHaveAttribute(
      "href",
      "https://www.facebook.com/example"
    );
    await expect(socialNav.getByRole("link", { name: "Instagram" })).toHaveAttribute(
      "href",
      "https://www.instagram.com/example"
    );
    await expect(socialNav.getByRole("link", { name: "YouTube" })).toHaveAttribute(
      "href",
      "https://www.youtube.com/@example"
    );
    await expect(socialNav.getByRole("link", { name: "TikTok" })).toHaveAttribute(
      "href",
      "https://www.tiktok.com/@example"
    );
  });

  test("default policy pages are linked and render template-specific content", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("contentinfo").getByRole("link", { name: "Privacy" })).toHaveAttribute(
      "href",
      "/privacy/"
    );
    await expect(page.getByRole("contentinfo").getByRole("link", { name: "Terms" })).toHaveAttribute(
      "href",
      "/terms/"
    );
    await expect(page.getByRole("contentinfo").getByRole("link", { name: "Cookies" })).toHaveAttribute(
      "href",
      "/cookies/"
    );

    for (const route of ["/privacy/", "/terms/", "/cookies/"]) {
      await page.goto(route);
      await expect(page.locator("h1, h2").first()).toBeVisible();
    }
  });

  test("PWA and discovery files are exported", async ({ page, request }) => {
    await page.goto("/");

    await expect(page.locator("link[rel='manifest']")).toHaveAttribute("href", "/manifest.webmanifest");
    await expect(page.locator("meta[name='theme-color']")).toHaveAttribute("content", "#1f332d");

    const manifest = await request.get("/manifest.webmanifest");
    expect(manifest.ok()).toBe(true);
    expect(await manifest.json()).toMatchObject({
      name: "Aurum Realty Group",
      display: "standalone",
      start_url: "/",
      theme_color: "#1f332d"
    });

    const serviceWorker = await request.get("/sw.js");
    expect(serviceWorker.ok()).toBe(true);
    const serviceWorkerText = await serviceWorker.text();
    expect(serviceWorkerText).toContain("CACHE_VERSION");
    expect(serviceWorkerText).toContain("/site.config.json");

    const llms = await request.get("/llms.txt");
    expect(llms.ok()).toBe(true);
    expect(await llms.text()).toContain("# Aurum Realty Group");
  });

  test("ships the real estate runtime config file", async ({ request }) => {
    const runtimeConfig = await request.get("/site.config.json");

    expect(runtimeConfig.ok()).toBe(true);
    await expect.poll(async () => (await runtimeConfig.json()).site.name).toBe("Aurum Realty Group");
  });
});
