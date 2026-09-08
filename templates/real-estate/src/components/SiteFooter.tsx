"use client";

import { Globe, Mail, Phone } from "lucide-react";
import {
  FaBluesky,
  FaDiscord,
  FaFacebookF,
  FaGithub,
  FaInstagram,
  FaLinkedin,
  FaMastodon,
  FaThreads,
  FaTiktok,
  FaWhatsapp,
  FaXTwitter,
  FaYoutube
} from "react-icons/fa6";
import { assetPath, getFooterLinksForConfig, getFooterSocialLinksForConfig } from "@/lib/site";
import { useRuntimeSiteConfig } from "@/components/RuntimeConfigProvider";
import { SmartLink } from "@/components/SmartLink";

export function SiteFooter() {
  const siteConfig = useRuntimeSiteConfig();
  const links = getFooterLinksForConfig(siteConfig);
  const socialLinks = getFooterSocialLinksForConfig(siteConfig);
  const footerLogo = siteConfig.footer.logo;

  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div className="site-footer__brand">
          {footerLogo ? (
            <SmartLink aria-label={`${siteConfig.site.name} home`} className="site-footer__brand-link" href="/">
              <img
                className="site-footer__logo"
                src={assetPath(footerLogo.src)}
                alt={footerLogo.alt || siteConfig.site.name}
                width={320}
                height={96}
                loading="lazy"
              />
            </SmartLink>
          ) : (
            <strong>{siteConfig.site.name}</strong>
          )}
          {siteConfig.footer.tagline ? <p>{siteConfig.footer.tagline}</p> : null}
          {socialLinks.length ? (
            <nav className="site-footer__social" aria-label="Social media links">
              {socialLinks.map((link) => (
                <SmartLink key={`${link.platform}-${link.href}`} className="site-footer__social-link" href={link.href}>
                  <SocialIcon platform={link.platform} />
                  <span className="sr-only">{link.label}</span>
                </SmartLink>
              ))}
            </nav>
          ) : null}
        </div>
        {links.length ? (
          <nav className="site-footer__links" aria-label="Footer navigation">
            {links.map((link) => (
              <SmartLink key={link.href} href={link.href}>
                {link.label}
              </SmartLink>
            ))}
          </nav>
        ) : null}
        {siteConfig.footer.copyright ? <p className="site-footer__copyright">{siteConfig.footer.copyright}</p> : null}
      </div>
    </footer>
  );
}

function SocialIcon({ platform }: { platform: string }) {
  const normalized = platform.trim().toLowerCase();

  switch (normalized) {
    case "github":
      return <FaGithub aria-hidden="true" focusable="false" />;
    case "linkedin":
      return <FaLinkedin aria-hidden="true" focusable="false" />;
    case "x":
    case "twitter":
      return <FaXTwitter aria-hidden="true" focusable="false" />;
    case "instagram":
      return <FaInstagram aria-hidden="true" focusable="false" />;
    case "facebook":
      return <FaFacebookF aria-hidden="true" focusable="false" />;
    case "youtube":
      return <FaYoutube aria-hidden="true" focusable="false" />;
    case "tiktok":
      return <FaTiktok aria-hidden="true" focusable="false" />;
    case "whatsapp":
      return <FaWhatsapp aria-hidden="true" focusable="false" />;
    case "phone":
    case "tel":
    case "mobile":
      return <Phone aria-hidden="true" focusable="false" />;
    case "discord":
      return <FaDiscord aria-hidden="true" focusable="false" />;
    case "mastodon":
      return <FaMastodon aria-hidden="true" focusable="false" />;
    case "threads":
      return <FaThreads aria-hidden="true" focusable="false" />;
    case "bluesky":
      return <FaBluesky aria-hidden="true" focusable="false" />;
    case "email":
    case "mail":
      return <Mail aria-hidden="true" focusable="false" />;
    default:
      return <Globe aria-hidden="true" focusable="false" />;
  }
}
