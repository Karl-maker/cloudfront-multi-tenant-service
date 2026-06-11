import Link from "next/link";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { isExternalHref, isGeneratedStaticHref, isHashHref, normalizeInternalHref } from "@/lib/site";

interface SmartLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: string;
  children: ReactNode;
}

export function SmartLink({ href, className, children, rel, target, ...anchorProps }: SmartLinkProps) {
  if (isExternalHref(href) || isHashHref(href) || isGeneratedStaticHref(href)) {
    const isWebUrl = /^https?:/.test(href);
    return (
      <a
        {...anchorProps}
        className={className}
        href={normalizeInternalHref(href)}
        rel={rel ?? (isWebUrl ? "noreferrer" : undefined)}
        target={target ?? (isWebUrl ? "_blank" : undefined)}
      >
        {children}
      </a>
    );
  }

  return (
    <Link {...anchorProps} className={className} href={normalizeInternalHref(href)}>
      {children}
    </Link>
  );
}
