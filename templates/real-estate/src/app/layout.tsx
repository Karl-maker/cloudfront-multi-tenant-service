import type { CSSProperties, ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import "@/app/globals.css";
import { PwaRegistration } from "@/components/PwaRegistration";
import { RuntimeConfigProvider } from "@/components/RuntimeConfigProvider";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { TrialBanner } from "@/components/TrialBanner";
import { buildSiteConfig as siteConfig } from "@/lib/build-site-config";
import { rootMetadata, rootViewport } from "@/lib/metadata";
import { serializeJsonLd, siteJsonLd } from "@/lib/structured-data";
import { assetPathForConfig } from "@/lib/site";
import { runtimeThemeVariables } from "@/lib/theme";

export const dynamic = "error";
export const metadata: Metadata = rootMetadata;
export const viewport: Viewport = rootViewport;

const language = siteConfig.site.locale.split("_")[0] || "en";

export default function RootLayout({ children }: { children: ReactNode }) {
  const organizationJsonLd = siteJsonLd();
  const serviceWorker = assetPathForConfig(siteConfig, siteConfig.site.pwa?.serviceWorker || "/sw.js");
  const serviceWorkerParams = new URLSearchParams();
  if (siteConfig.site.pwa?.cacheName) serviceWorkerParams.set("cache", siteConfig.site.pwa.cacheName);
  if (siteConfig.site.pwa?.offlinePath) serviceWorkerParams.set("offline", siteConfig.site.pwa.offlinePath);
  const serviceWorkerQuery = serviceWorkerParams.toString();
  const serviceWorkerPath = serviceWorkerQuery ? `${serviceWorker}?${serviceWorkerQuery}` : serviceWorker;

  return (
    <html lang={language}>
      <body style={runtimeThemeVariables(siteConfig) as CSSProperties}>
        <RuntimeConfigProvider initialConfig={siteConfig}>
          <a className="skip-link" href="#main">
            Skip to content
          </a>
          {organizationJsonLd ? (
            <script
              type="application/ld+json"
              dangerouslySetInnerHTML={{ __html: serializeJsonLd(organizationJsonLd) }}
            />
          ) : null}
          <TrialBanner />
          <SiteHeader />
          {children}
          <SiteFooter />
          <PwaRegistration
            enabled={siteConfig.site.pwa?.enabled ?? true}
            serviceWorkerPath={serviceWorkerPath}
          />
        </RuntimeConfigProvider>
      </body>
    </html>
  );
}
