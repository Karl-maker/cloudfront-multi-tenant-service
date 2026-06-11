"use client";

import { useEffect } from "react";
import { SectionRenderer } from "@/components/SectionRenderer";
import { useRuntimeSiteConfig } from "@/components/RuntimeConfigProvider";
import { backgroundStyleValue, getPageByPathFromConfig, pageDescriptionForConfig } from "@/lib/site";

export function ConfiguredPageClient({ path }: { path: string }) {
  const siteConfig = useRuntimeSiteConfig();
  const page = getPageByPathFromConfig(siteConfig, path);

  useEffect(() => {
    if (!page) return;

    const title = page.seo?.title || page.title;
    const description = pageDescriptionForConfig(siteConfig, page);

    document.title = siteConfig.seo.titleTemplate
      ? siteConfig.seo.titleTemplate.replace("%s", title)
      : `${title} | ${siteConfig.site.name}`;
    setMeta("description", description);
    setMeta("application-name", siteConfig.site.name);
    setMeta("theme-color", siteConfig.site.manifest?.themeColor || siteConfig.theme.colors.primary);
    setProperty("og:site_name", siteConfig.site.name);
    setProperty("og:title", title);
    setProperty("og:description", description);
    setProperty("og:url", new URL(page.path, siteConfig.site.url).toString());
    setProperty("og:image", new URL(page.seo?.image || siteConfig.seo.defaultImage, siteConfig.site.url).toString());
    setMeta("twitter:title", title);
    setMeta("twitter:description", description);
    setMeta("twitter:image", new URL(page.seo?.image || siteConfig.seo.defaultImage, siteConfig.site.url).toString());
  }, [page, siteConfig]);

  if (!page) {
    return (
      <main id="main" className="page page--default">
        <section className="section">
          <div className="section__inner section__inner--narrow">
            <h1>Page not configured</h1>
            <p>This static route exists, but the runtime config no longer includes content for it.</p>
          </div>
        </section>
      </main>
    );
  }

  const background = backgroundStyleValue(page.background);

  return (
    <main
      id="main"
      className={`page page--${page.layout || "default"}`}
      style={background ? { background } : undefined}
    >
      <SectionRenderer sections={page.sections} />
    </main>
  );
}

function setMeta(name: string, content: string) {
  setMetaAttribute("name", name, content);
}

function setProperty(property: string, content: string) {
  setMetaAttribute("property", property, content);
}

function setMetaAttribute(attribute: "name" | "property", value: string, content: string) {
  let element = document.querySelector<HTMLMetaElement>(`meta[${attribute}="${value}"]`);

  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, value);
    document.head.append(element);
  }

  element.content = content;
}
