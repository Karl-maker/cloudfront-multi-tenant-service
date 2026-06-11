"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { normalizeFolderName, validateSiteConfig } = require("./site-config-schema");
const { getTheme, resolveThemeName } = require("./site-themes");

const DEFAULT_SCHEMA = "../../templates/real-estate/content/site.schema.json";

function buildSiteConfig(input = {}, options = {}) {
  const folder = normalizeFolderName(
    options.folder ||
      options.site ||
      input.syncpoly?.folder ||
      input.site?.slug ||
      input.site?.folder ||
      input.slug ||
      input.name ||
      input.business?.name ||
      input.site?.name
  );
  if (!folder) {
    throw new Error("Missing site name. Pass --site or provide site.name/business.name in the input JSON.");
  }

  const siteName = cleanText(input.site?.name || input.business?.name || input.name || titleFromSlug(folder));
  const shortName = cleanText(input.site?.shortName || input.shortName || siteName);
  const url = cleanText(input.site?.url || input.url || `https://${folder}.syncpoly.com`);
  const description = cleanText(
    input.site?.description ||
      input.description ||
      input.business?.description ||
      `${siteName} website.`
  );
  const locale = cleanText(input.site?.locale || input.locale || "en_US");
  const keywords = compactArray(input.site?.keywords || input.keywords || input.seo?.keywords);
  const media = normalizeMedia(input.media || {});
  const heroImage = cleanText(input.seo?.defaultImage || input.seo?.image || media.ogImage || media.hero || media.gallery[0]?.src || "/media/og-default.svg");
  const phone = cleanText(input.contact?.phone || input.phone);
  const email = cleanText(input.contact?.email || input.email);
  const whatsapp = cleanText(input.contact?.whatsapp || input.whatsapp || phone);
  const bookingHref = cleanText(input.booking?.href || input.booking?.url || input.bookingUrl || input.contact?.bookingHref);
  const contactHref = cleanText(input.contact?.primaryHref || input.primaryHref || bookingHref || whatsappHref(whatsapp) || phoneHref(phone) || mailHref(email) || "#contact");
  const contactLabel = cleanText(input.contact?.ctaLabel || input.copy?.ctaLabel || input.ctaLabel || (bookingHref ? "Book now" : "Contact"));
  const services = normalizeItems(input.services || input.offers || input.features, "Service", description);
  const faqs = normalizeFaqs(input.faqs || input.questions);
  const testimonials = compactArray(input.testimonials).length > 0 ? normalizeItems(input.testimonials, "Client note", "") : [];
  const stats = normalizeStats(input.stats);
  const pricing = normalizePricing(input.pricing || input.packages);
  const map = normalizeMap(input.map || input.locationMap || input.location);
  const themeName = resolveThemeName({
    theme: options.theme,
    inputTheme: input.themePreset || input.theme?.preset,
    template: options.template || input.template || input.syncpoly?.template
  });
  const theme = mergeThemeOverrides(getTheme(themeName), input.theme);
  const title = cleanText(input.seo?.defaultTitle || input.seo?.title || `${siteName} | ${input.business?.industry || "Website"}`);
  const homeSeoDescription = cleanText(input.seo?.description || description);

  const config = {
    $schema: input.$schema || DEFAULT_SCHEMA,
    deployment: {
      basePath: "",
      assetPrefix: ""
    },
    syncpoly: {
      folder
    },
    site: {
      name: siteName,
      shortName,
      url,
      locale,
      description,
      updatedAt: cleanText(input.site?.updatedAt || input.updatedAt || options.updatedAt || new Date().toISOString().slice(0, 10)),
      keywords,
      author: {
        name: siteName,
        url
      },
      manifest: {
        display: "standalone",
        orientation: "portrait",
        backgroundColor: theme.colors.background,
        themeColor: theme.colors.primary,
        icon: media.favicon || "/media/favicon.svg",
        categories: compactArray(input.site?.manifest?.categories || input.categories || ["business"])
      },
      llms: {
        summary: cleanText(input.llms?.summary || input.summary || description),
        notes: compactArray(input.llms?.notes || input.notes)
      }
    },
    seo: {
      titleTemplate: cleanText(input.seo?.titleTemplate || `%s | ${siteName}`),
      defaultTitle: title,
      defaultImage: heroImage,
      robots: {
        index: input.seo?.robots?.index !== false,
        follow: input.seo?.robots?.follow !== false,
        allow: compactArray(input.seo?.robots?.allow || ["/"]),
        disallow: compactArray(input.seo?.robots?.disallow || [])
      },
      structuredData: buildStructuredData({ input, siteName, url, description, phone, email })
    },
    theme,
    navigation: buildNavigation({ input, siteName, media, pricing, contactHref, contactLabel }),
    blocks: {
      defaultFaq: buildFaqBlock(faqs, input),
      defaultContact: buildContactBlock({ input, siteName, phone, email, whatsapp, contactHref })
    },
    pages: [
      {
        path: "/",
        title: "Home",
        layout: "landing",
        description,
        seo: {
          title,
          description: homeSeoDescription,
          image: heroImage
        },
        sections: buildHomeSections({
          input,
          siteName,
          description,
          heroImage,
          media,
          services,
          stats,
          pricing,
          map,
          testimonials,
          bookingHref,
          whatsapp,
          contactHref,
          contactLabel
        })
      }
    ],
    footer: buildFooter({ input, siteName, pricing, phone, email, whatsapp })
  };

  const errors = validateSiteConfig(config);
  if (errors.length > 0) {
    throw new Error(["Generated site config failed validation:", ...errors.map((error) => `- ${error}`)].join("\n"));
  }

  return config;
}

function buildSiteInput(input = {}, options = {}) {
  const folder = normalizeFolderName(
    options.site ||
      options.folder ||
      input.syncpoly?.folder ||
      input.site?.slug ||
      input.site?.folder ||
      input.slug ||
      input.name ||
      input.business?.name ||
      input.site?.name
  );
  const siteName = cleanText(input.site?.name || input.business?.name || input.name || titleFromSlug(folder));
  if (!siteName) {
    throw new Error("Missing site name for site.input.json.");
  }

  const phone = cleanText(input.contact?.phone || input.phone);
  const email = cleanText(input.contact?.email || input.email);
  const whatsapp = cleanText(input.contact?.whatsapp || input.whatsapp || phone);

  return pruneEmpty({
    site: {
      name: siteName,
      shortName: cleanText(input.site?.shortName || input.shortName || siteName),
      description: cleanText(input.site?.description || input.description || input.business?.description || `${siteName} website.`),
      locale: cleanText(input.site?.locale || input.locale || "en_US"),
      keywords: compactArray(input.site?.keywords || input.keywords || input.seo?.keywords)
    },
    business: {
      name: siteName,
      industry: cleanText(input.business?.industry || input.industry || "Business"),
      location: cleanText(input.business?.location || input.location || input.serviceArea),
      story: cleanText(input.business?.story || input.story)
    },
    contact: {
      phone,
      email,
      whatsapp,
      ctaLabel: cleanText(input.contact?.ctaLabel || input.copy?.ctaLabel || input.ctaLabel || "Book now"),
      bookingHref: cleanText(input.contact?.bookingHref || input.booking?.href || input.booking?.url || input.bookingUrl)
    },
    booking: {
      label: cleanText(input.booking?.label || input.bookingLabel || "Book now"),
      href: cleanText(input.booking?.href || input.booking?.url || input.bookingUrl || input.contact?.bookingHref)
    },
    media: normalizeMediaInput(input.media || {}),
    copy: {
      kicker: cleanText(input.copy?.kicker || input.kicker || input.business?.industry || input.industry),
      headline: cleanText(input.copy?.headline || input.copy?.title || input.headline || `${siteName} makes service simple to book.`),
      subheadline: cleanText(input.copy?.subheadline || input.copy?.body || input.subheadline || input.site?.description || input.description),
      secondaryCtaLabel: cleanText(input.copy?.secondaryCtaLabel || input.secondaryCtaLabel || "View details"),
      secondaryCtaHref: cleanText(input.copy?.secondaryCtaHref || input.secondaryCtaHref || "#details")
    },
    services: normalizeItems(input.services || input.offers || input.features, "Service", input.site?.description || input.description),
    pricing: normalizePricing(input.pricing || input.packages),
    map: normalizeMap(input.map || input.locationMap || input.location),
    stats: normalizeStats(input.stats),
    faqs: normalizeFaqs(input.faqs || input.questions),
    testimonials: compactArray(input.testimonials).length > 0 ? normalizeItems(input.testimonials, "Client note", "") : [],
    seo: {
      title: cleanText(input.seo?.defaultTitle || input.seo?.title),
      description: cleanText(input.seo?.description),
      image: cleanText(input.seo?.defaultImage || input.seo?.image)
    },
    llms: {
      summary: cleanText(input.llms?.summary || input.summary),
      notes: compactArray(input.llms?.notes || input.notes)
    }
  });
}

function writeSiteConfig({ input, output, site, theme, template, updatedAt }) {
  const config = buildSiteConfig(input, { site, theme, template, updatedAt });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(config, null, 2)}\n`);
  return config;
}

function writeSiteInput({ input, output, site }) {
  const siteInput = buildSiteInput(input, { site });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(siteInput, null, 2)}\n`);
  return siteInput;
}

function buildSeoFiles(config) {
  const pages = Array.isArray(config.pages) ? config.pages : [];
  const pageUrls = pages.map((page) => new URL(normalizePagePath(page.path), config.site.url).toString());
  const sitemapUrls = pageUrls.length > 0 ? pageUrls : [config.site.url];
  const llmsNotes = compactArray(config.site?.llms?.notes);
  const llmsText = [
    `${config.site.name} is represented by ${config.site.url}.`,
    "",
    config.site.description,
    "",
    `Primary title: ${config.seo.defaultTitle}`,
    `Primary image: ${config.seo.defaultImage}`,
    "",
    "Pages:",
    ...pages.map((page) => `- ${page.title}: ${new URL(normalizePagePath(page.path), config.site.url).toString()}`),
    ...(llmsNotes.length > 0 ? ["", "Notes:", ...llmsNotes.map((note) => `- ${note}`)] : [])
  ].join("\n") + "\n";

  return {
    "robots.txt": [
      "User-agent: *",
      ...(config.seo?.robots?.disallow || []).map((entry) => `Disallow: ${entry}`),
      `Sitemap: ${new URL("/sitemap.xml", config.site.url).toString()}`
    ].join("\n") + "\n",
    "sitemap.xml": buildSitemapXml(sitemapUrls, config.site.updatedAt),
    "llms.txt": llmsText,
    "llm.txt": llmsText
  };
}

function writeSeoFiles({ config, siteDir }) {
  fs.mkdirSync(siteDir, { recursive: true });
  const files = buildSeoFiles(config);
  for (const [fileName, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(siteDir, fileName), contents);
  }
  return Object.keys(files).map((fileName) => path.join(siteDir, fileName));
}

function buildHomeSections({
  input,
  siteName,
  description,
  heroImage,
  media,
  services,
  stats,
  pricing,
  map,
  testimonials,
  bookingHref,
  whatsapp,
  contactHref,
  contactLabel
}) {
  const copy = input.copy || {};
  const actions = buildPrimaryActions({ contactLabel, contactHref, bookingHref, whatsapp, input });
  const sections = [
    {
      id: "hero",
      type: "hero",
      variant: cleanText(copy.heroVariant || "centered"),
      kicker: cleanText(copy.kicker || input.business?.industry || "Luxury website"),
      title: cleanText(copy.headline || copy.title || `${siteName} makes service simple to book.`),
      body: cleanText(copy.subheadline || copy.body || description),
      actions,
      background: {
        type: "image",
        value: heroImage,
        overlay: "linear-gradient(90deg, rgba(7, 38, 48, 0.78), rgba(7, 38, 48, 0.36) 56%, rgba(7, 38, 48, 0.18))"
      },
      ...(stats.length > 0 ? { stats: stats.slice(0, 4).map(({ label, value }) => ({ label, value })) } : {})
    }
  ];

  if (media.gallery.length > 1) {
    sections.push({
      id: "gallery",
      type: "mediaGallery",
      kicker: cleanText(copy.galleryKicker || "Gallery"),
      title: cleanText(copy.galleryTitle || "A visual preview of the experience."),
      mediaItems: media.gallery
    });
  }

  sections.push({
      id: "services",
      type: "featureGrid",
      kicker: cleanText(copy.featureKicker || "Services"),
      title: cleanText(copy.featureTitle || "Service options built around what customers need."),
      columns: Math.min(Math.max(services.length, 1), 3),
      items: services
  });

  if (pricing.length > 0) {
    sections.push({
      id: "rates",
      type: "rates",
      kicker: cleanText(copy.pricingKicker || copy.ratesKicker || "Rates"),
      title: cleanText(copy.pricingTitle || "Simple options to start the conversation."),
      body: cleanText(copy.pricingBody || "Use pricing as a guide. Final scope can be confirmed after a quick message."),
      columns: Math.min(Math.max(pricing.length, 1), 3),
      items: pricing,
      actions: actions.slice(0, 2)
    });
  }

  sections.push({
    id: "story",
    type: "split",
    variant: "mediaLeft",
    kicker: cleanText(copy.storyKicker || "About"),
    title: cleanText(copy.storyTitle || `${siteName} at a glance.`),
    body: cleanText(copy.storyBody || input.business?.story || description),
    media: {
      src: cleanText(media.split || heroImage),
      alt: cleanText(media.splitAlt || `${siteName} visual`)
    },
    actions: [
      {
        label: contactLabel,
        href: contactHref,
        style: "primary"
      }
    ]
  });

  if (stats.length > 0) {
    sections.push({
      id: "stats",
      type: "stats",
      kicker: cleanText(copy.statsKicker || "Proof"),
      title: cleanText(copy.statsTitle || "Useful details at a glance."),
      items: stats
    });
  }

  if (testimonials.length > 0) {
    sections.push({
      id: "testimonials",
      type: "testimonials",
      kicker: cleanText(copy.testimonialsKicker || "Trust"),
      title: cleanText(copy.testimonialsTitle || "What people say."),
      items: testimonials
    });
  }

  if (map) {
    sections.push({
      id: "location",
      type: "location",
      kicker: cleanText(copy.mapKicker || "Location"),
      title: cleanText(copy.mapTitle || "Find us or check the service area."),
      body: cleanText(copy.mapBody || map.body || ""),
      map,
      actions: actions.slice(0, 2)
    });
  }

  sections.push({ use: "defaultFaq" });
  sections.push({ use: "defaultContact" });
  sections.push({
    id: "cta",
    type: "cta",
    kicker: cleanText(copy.ctaKicker || "Next step"),
    title: cleanText(copy.ctaTitle || `Ready to talk with ${siteName}?`),
    body: cleanText(copy.ctaBody || "Use the contact option below and share what you need."),
    actions: [
      {
        label: contactLabel,
        href: contactHref,
        style: "primary"
      }
    ]
  });

  return sections;
}

function buildPrimaryActions({ contactLabel, contactHref, bookingHref, whatsapp, input }) {
  const copy = input.copy || {};
  const actions = [];
  const bookingLabel = cleanText(input.booking?.label || input.bookingLabel || contactLabel || "Book now");
  if (bookingHref) {
    actions.push({ label: bookingLabel, href: bookingHref, style: "primary" });
  } else {
    actions.push({ label: contactLabel, href: contactHref, style: "primary" });
  }

  const whatsappLink = whatsappHref(whatsapp);
  if (whatsappLink && whatsappLink !== actions[0]?.href) {
    actions.push({ label: cleanText(input.contact?.whatsappLabel || "WhatsApp"), href: whatsappLink, style: "secondary" });
  } else {
    actions.push({
      label: cleanText(copy.secondaryCtaLabel || "View services"),
      href: cleanText(copy.secondaryCtaHref || "#services"),
      style: "secondary"
    });
  }

  return actions;
}

function buildNavigation({ input, siteName, media, pricing, contactHref, contactLabel }) {
  const defaultLinks = [
    { label: "Home", href: "/" },
    { label: "Services", href: "#services" },
    ...(pricing.length > 0 ? [{ label: "Rates", href: "#rates" }] : []),
    { label: "Contact", href: "#contact" }
  ];
  const navigation = {
    logoText: cleanText(input.navigation?.logoText || siteName),
    links: compactArray(input.navigation?.links).length > 0
      ? input.navigation.links
      : defaultLinks,
    cta: {
      label: contactLabel,
      href: contactHref,
      style: "primary"
    }
  };

  const logo = cleanText(input.navigation?.logo?.src || media.logo);
  if (logo) {
    navigation.logo = {
      src: logo,
      alt: cleanText(input.navigation?.logo?.alt || `${siteName} logo`)
    };
  }

  return navigation;
}

function buildFaqBlock(faqs, input) {
  return {
    id: "faq",
    type: "faq",
    kicker: cleanText(input.copy?.faqKicker || "FAQ"),
    title: cleanText(input.copy?.faqTitle || "Quick questions"),
    items: faqs.length > 0 ? faqs : [
      {
        question: "How do I get in touch?",
        answer: "Use the contact details on this site and share what you need."
      }
    ]
  };
}

function buildContactBlock({ input, siteName, phone, email, whatsapp, contactHref }) {
  const methods = [];
  if (phone) {
    methods.push({ label: "Phone", value: phone, href: phoneHref(phone) });
  }
  if (whatsapp) {
    methods.push({ label: "WhatsApp", value: whatsapp, href: whatsappHref(whatsapp) || contactHref });
  }
  if (email) {
    methods.push({ label: "Email", value: email, href: mailHref(email) });
  }
  const bookingHref = cleanText(input.booking?.href || input.booking?.url || input.bookingUrl || input.contact?.bookingHref);
  if (bookingHref) {
    methods.push({ label: cleanText(input.booking?.label || "Booking"), value: cleanText(input.booking?.value || "Book online"), href: bookingHref });
  }
  for (const method of compactArray(input.contact?.methods)) {
    methods.push(method);
  }

  if (methods.length === 0) {
    methods.push({ label: "Contact", value: "Contact for details", href: contactHref });
  }

  return {
    id: "contact",
    type: "contact",
    title: cleanText(input.copy?.contactTitle || `Contact ${siteName}`),
    body: cleanText(input.copy?.contactBody || "Reach out for questions, availability, or next steps."),
    methods,
    form: {
      enabled: input.contact?.form?.enabled === true
    }
  };
}

function buildFooter({ input, siteName, pricing, phone, email, whatsapp }) {
  const defaultLinks = [
    { label: "Services", href: "#services" },
    ...(pricing.length > 0 ? [{ label: "Rates", href: "#rates" }] : []),
    { label: "Contact", href: "#contact" }
  ];

  return {
    tagline: cleanText(input.footer?.tagline),
    copyright: cleanText(input.footer?.copyright || `${new Date().getFullYear()} ${siteName}`),
    links: compactArray(input.footer?.links).length > 0 ? input.footer.links : defaultLinks,
    socialLinks: buildFooterSocialLinks({ input, phone, email, whatsapp })
  };
}

function buildFooterSocialLinks({ input, phone, email, whatsapp }) {
  const links = compactArray(input.footer?.socialLinks || input.socialLinks || input.social?.links);
  const seen = new Set();
  const output = [];

  function pushLink(link) {
    const platform = cleanText(link.platform || link.label || link.name);
    const href = cleanText(link.href || link.url);
    if (!platform || !href || seen.has(`${platform}:${href}`)) {
      return;
    }
    seen.add(`${platform}:${href}`);
    output.push({
      platform,
      label: cleanText(link.label || platform),
      href
    });
  }

  if (whatsapp) {
    pushLink({ platform: "whatsapp", label: "WhatsApp", href: whatsappHref(whatsapp) });
  }
  if (phone) {
    pushLink({ platform: "phone", label: "Phone", href: phoneHref(phone) });
  }
  if (email) {
    pushLink({ platform: "email", label: "Email", href: mailHref(email) });
  }

  for (const link of links) {
    pushLink(link);
  }

  return output;
}

function buildStructuredData({ input, siteName, url, description, phone, email }) {
  const type = cleanText(input.seo?.structuredData?.["@type"] || input.business?.schemaType || "Organization");
  const data = {
    "@context": "https://schema.org",
    "@type": type,
    name: siteName,
    url,
    description
  };
  if (phone) data.telephone = phone;
  if (email) data.email = email;
  if (input.contact?.address) data.address = input.contact.address;
  return data;
}

function buildSitemapXml(urls, updatedAt) {
  const lastmod = cleanText(updatedAt || new Date().toISOString().slice(0, 10));
  const entries = urls
    .map((url) => [
      "  <url>",
      `    <loc>${escapeXml(url)}</loc>`,
      `    <lastmod>${escapeXml(lastmod)}</lastmod>`,
      "  </url>"
    ].join("\n"))
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    entries,
    "</urlset>",
    ""
  ].join("\n");
}

function normalizeMedia(media) {
  const gallery = compactArray(media.gallery || media.mediaItems)
    .map((item) => {
      if (typeof item === "string") {
        return { src: item, alt: "" };
      }
      return {
        src: cleanText(item.src || item.url || item.path),
        alt: cleanText(item.alt || item.title || "")
      };
    })
    .filter((item) => item.src);

  const hero = cleanText(media.hero?.src || media.hero || media.background || media.image);
  if (hero && !gallery.some((item) => item.src === hero)) {
    gallery.unshift({ src: hero, alt: cleanText(media.hero?.alt || media.heroAlt || "") });
  }

  return {
    hero,
    heroAlt: cleanText(media.hero?.alt || media.heroAlt),
    split: cleanText(media.split?.src || media.split || gallery[1]?.src || hero),
    splitAlt: cleanText(media.split?.alt || media.splitAlt || gallery[1]?.alt || media.hero?.alt || ""),
    logo: cleanText(media.logo?.src || media.logo),
    favicon: cleanText(media.favicon?.src || media.favicon),
    ogImage: cleanText(media.ogImage?.src || media.ogImage),
    gallery
  };
}

function normalizeMediaInput(media) {
  const normalized = normalizeMedia(media);
  return pruneEmpty({
    hero: normalized.hero,
    heroAlt: normalized.heroAlt,
    split: normalized.split,
    splitAlt: normalized.splitAlt,
    logo: normalized.logo,
    favicon: normalized.favicon,
    ogImage: normalized.ogImage,
    gallery: normalized.gallery
  });
}

function normalizeItems(items, fallbackTitle, fallbackBody) {
  const normalized = compactArray(items)
    .map((item, index) => {
      if (typeof item === "string") {
        return { title: item, body: fallbackBody };
      }
      const normalizedItem = {
        title: cleanText(item.title || item.name || `${fallbackTitle} ${index + 1}`),
        body: cleanText(item.body || item.description || item.text || fallbackBody)
      };
      const media = item.media || item.image;
      const src = cleanText(media?.src || media);
      if (src) {
        normalizedItem.media = {
          src,
          alt: cleanText(media?.alt || item.alt || normalizedItem.title)
        };
      }
      return normalizedItem;
    })
    .filter((item) => item.title && item.body);

  if (normalized.length > 0) {
    return normalized;
  }

  return [
    {
      title: fallbackTitle,
      body: fallbackBody || "Clear information and a simple way to get in touch."
    }
  ];
}

function normalizeFaqs(faqs) {
  return compactArray(faqs)
    .map((item) => ({
      question: cleanText(item.question || item.q),
      answer: cleanText(item.answer || item.a)
    }))
    .filter((item) => item.question && item.answer);
}

function normalizeStats(stats) {
  return compactArray(stats)
    .map((item) => ({
      value: cleanText(item.value || item.number),
      label: cleanText(item.label || item.title),
      body: cleanText(item.body || item.description)
    }))
    .filter((item) => item.value && item.label);
}

function normalizePricing(pricing) {
  return compactArray(pricing)
    .map((item, index) => {
      if (typeof item === "string") {
        return { title: item, price: "Contact for pricing", body: "Message to confirm scope and availability." };
      }
      return pruneEmpty({
        title: cleanText(item.title || item.name || `Option ${index + 1}`),
        price: cleanText(item.price || item.value || item.rate),
        label: cleanText(item.label || item.badge),
        body: cleanText(item.body || item.description || item.text),
        href: cleanText(item.href || item.url),
        amenities: compactArray(item.amenities || item.features || item.bullets).map(cleanText)
      });
    })
    .filter((item) => item.title && (item.price || item.body || item.amenities?.length));
}

function normalizeMap(map) {
  if (typeof map === "string") {
    const query = cleanText(map);
    return query ? mapFromQuery(query) : null;
  }
  if (!map || typeof map !== "object") {
    return null;
  }
  const query = cleanText(map.query || map.address || map.location || map.place);
  const embedUrl = cleanText(map.embedUrl || map.src);
  const href = cleanText(map.href || map.url || (query ? googleMapsSearchUrl(query) : ""));
  if (!query && !embedUrl && !href) {
    return null;
  }
  return pruneEmpty({
    query,
    embedUrl: embedUrl || (query ? googleMapsEmbedUrl(query) : ""),
    href,
    label: cleanText(map.label || "Open in Google Maps"),
    title: cleanText(map.title || query || "Google Maps"),
    body: cleanText(map.body || map.description)
  });
}

function mergeThemeOverrides(theme, overrides = {}) {
  if (!overrides || typeof overrides !== "object") {
    return theme;
  }

  const merged = JSON.parse(JSON.stringify(theme));
  for (const key of ["mode", "radius", "maxWidth"]) {
    const value = cleanText(overrides[key]);
    if (value) {
      merged[key] = value;
    }
  }

  for (const key of ["colors", "fonts", "background"]) {
    if (overrides[key] && typeof overrides[key] === "object" && !Array.isArray(overrides[key])) {
      merged[key] = {
        ...(merged[key] || {}),
        ...pruneEmpty(overrides[key])
      };
    }
  }

  const customCss = cleanText(overrides.customCss);
  if (customCss) {
    merged.customCss = [merged.customCss, customCss].filter(Boolean).join("\n");
  }

  return merged;
}

function mapFromQuery(query) {
  return {
    query,
    embedUrl: googleMapsEmbedUrl(query),
    href: googleMapsSearchUrl(query),
    label: "Open in Google Maps",
    title: query
  };
}

function normalizePagePath(pagePath) {
  if (!pagePath || pagePath === "/") {
    return "/";
  }
  return `/${String(pagePath).replace(/^\/+|\/+$/g, "")}/`;
}

function cleanText(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value).trim();
}

function pruneEmpty(value) {
  if (Array.isArray(value)) {
    return value.map(pruneEmpty).filter((item) => {
      if (Array.isArray(item)) return item.length > 0;
      if (item && typeof item === "object") return Object.keys(item).length > 0;
      return item !== "";
    });
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const output = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    const pruned = pruneEmpty(nestedValue);
    if (Array.isArray(pruned) && pruned.length === 0) continue;
    if (pruned && typeof pruned === "object" && Object.keys(pruned).length === 0) continue;
    if (pruned === "") continue;
    output[key] = pruned;
  }
  return output;
}

function compactArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item) => item !== undefined && item !== null && item !== "");
}

function titleFromSlug(slug) {
  return String(slug || "")
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function phoneHref(phone) {
  const digits = String(phone || "").replace(/[^0-9+]/g, "");
  return digits ? `tel:${digits}` : "";
}

function whatsappHref(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : "";
}

function googleMapsSearchUrl(query) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function googleMapsEmbedUrl(query) {
  return `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`;
}

function mailHref(email) {
  return email ? `mailto:${email}` : "";
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

module.exports = {
  buildSeoFiles,
  buildSiteInput,
  buildSiteConfig,
  writeSeoFiles,
  writeSiteInput,
  writeSiteConfig
};
