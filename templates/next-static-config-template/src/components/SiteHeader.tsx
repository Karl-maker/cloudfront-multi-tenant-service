"use client";

import { useEffect, useId, useState } from "react";
import { Menu, X } from "lucide-react";
import { assetPath, getNavigationCtaForConfig, getNavigationLinksForConfig } from "@/lib/site";
import { useRuntimeSiteConfig } from "@/components/RuntimeConfigProvider";
import { SmartLink } from "@/components/SmartLink";

export function SiteHeader() {
  const siteConfig = useRuntimeSiteConfig();
  const links = getNavigationLinksForConfig(siteConfig);
  const cta = getNavigationCtaForConfig(siteConfig);
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoLoaded, setLogoLoaded] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const [isAtTop, setIsAtTop] = useState(true);
  const menuId = useId();
  const logoSrc = siteConfig.navigation.logo?.src;
  const hasLogo = Boolean(siteConfig.navigation.logo);
  const showLogo = hasLogo && logoLoaded && !logoFailed;
  const brandLabel = `${siteConfig.site.name} home`;

  const closeMenu = () => setMenuOpen(false);

  useEffect(() => {
    setLogoLoaded(false);
    setLogoFailed(false);
  }, [logoSrc]);

  useEffect(() => {
    const updateHeaderState = () => setIsAtTop(window.scrollY < 8);

    updateHeaderState();
    window.addEventListener("scroll", updateHeaderState, { passive: true });
    return () => window.removeEventListener("scroll", updateHeaderState);
  }, []);

  return (
    <header className={isAtTop && !menuOpen ? "site-header site-header--at-top" : "site-header"}>
      <div className={hasLogo ? "site-header__inner" : "site-header__inner site-header__inner--no-brand"}>
        {hasLogo ? (
          <SmartLink
            aria-label={brandLabel}
            className="site-header__brand site-header__brand--logo-only"
            href="/"
          >
            <img
              aria-hidden="true"
              className={showLogo ? "site-header__logo" : "site-header__logo site-header__logo--loading"}
              src={assetPath(siteConfig.navigation.logo?.src || "")}
              alt=""
              width={160}
              height={48}
              onLoad={() => setLogoLoaded(true)}
              onError={() => setLogoFailed(true)}
            />
          </SmartLink>
        ) : null}
        <button
          aria-controls={menuId}
          aria-expanded={menuOpen}
          className="site-header__menu-button"
          onClick={() => setMenuOpen((isOpen) => !isOpen)}
          type="button"
        >
          {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          <span className="sr-only">{menuOpen ? "Close menu" : "Open menu"}</span>
        </button>
        <div
          className={menuOpen ? "site-header__panel site-header__panel--open" : "site-header__panel"}
          id={menuId}
        >
          <nav className="site-header__nav" aria-label="Primary navigation">
            {links.map((link) => (
              <SmartLink key={link.href} className="site-header__link" href={link.href} onClick={closeMenu}>
                {link.label}
              </SmartLink>
            ))}
          </nav>
          {cta ? (
            <SmartLink
              className={`button button--${cta.style || "primary"} site-header__cta`}
              href={cta.href}
              onClick={closeMenu}
            >
              {cta.label}
            </SmartLink>
          ) : null}
        </div>
      </div>
    </header>
  );
}
