"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";
import { assetPath, siteConfig as fallbackConfig } from "@/lib/site";
import { runtimeThemeStyle } from "@/lib/theme";
import type { SiteConfig } from "@/types/site";

const RuntimeConfigContext = createContext<SiteConfig>(fallbackConfig);

export function RuntimeConfigProvider({
  children,
  initialConfig = fallbackConfig
}: {
  children: ReactNode;
  initialConfig?: SiteConfig;
}) {
  const [config, setConfig] = useState<SiteConfig | null>(null);
  const activeConfig = config || initialConfig;

  useEffect(() => {
    let isMounted = true;

    fetch(assetPath("/site.config.json"), { cache: "no-cache" })
      .then((response) => {
        if (!response.ok) throw new Error(`Unable to load runtime config: ${response.status}`);
        return response.json() as Promise<SiteConfig>;
      })
      .then((runtimeConfig) => {
        if (isMounted) setConfig(runtimeConfig);
      })
      .catch(() => {
        if (isMounted) setConfig(initialConfig);
      });

    return () => {
      isMounted = false;
    };
  }, [initialConfig]);

  const themeStyle = useMemo(() => runtimeThemeStyle(activeConfig), [activeConfig]);

  return (
    <RuntimeConfigContext.Provider value={activeConfig}>
      <style dangerouslySetInnerHTML={{ __html: themeStyle }} />
      {activeConfig.theme.customCss ? <style dangerouslySetInnerHTML={{ __html: activeConfig.theme.customCss }} /> : null}
      {config ? children : <SiteSkeleton />}
    </RuntimeConfigContext.Provider>
  );
}

export function useRuntimeSiteConfig() {
  return useContext(RuntimeConfigContext);
}

function SiteSkeleton() {
  return (
    <div className="site-skeleton" aria-busy="true" aria-label="Loading site content">
      <div className="site-skeleton__bar" />
      <main id="main" className="site-skeleton__main">
        <div className="site-skeleton__copy">
          <span className="site-skeleton__line site-skeleton__line--kicker" />
          <span className="site-skeleton__line site-skeleton__line--title" />
          <span className="site-skeleton__line site-skeleton__line--title-short" />
          <span className="site-skeleton__line site-skeleton__line--body" />
          <span className="site-skeleton__line site-skeleton__line--body-short" />
          <div className="site-skeleton__actions">
            <span />
            <span />
          </div>
        </div>
        <div className="site-skeleton__media" />
      </main>
    </div>
  );
}
