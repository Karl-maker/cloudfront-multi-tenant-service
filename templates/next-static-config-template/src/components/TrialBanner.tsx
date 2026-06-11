"use client";

import { useEffect, useState } from "react";
import { assetPath } from "@/lib/site";
import { useRuntimeSiteConfig } from "@/components/RuntimeConfigProvider";

const defaultTrialBanner = {
  text: "This site was built with SyncPoly.",
  href: "https://www.syncpoly.com",
  image: {
    src: "https://d1mp8fjhswh27j.cloudfront.net/assets/syncpoly-icon.png",
    alt: "SyncPoly icon"
  },
  buttonLabel: "Check us out"
};

export function TrialBanner() {
  const siteConfig = useRuntimeSiteConfig();
  const [imageFailed, setImageFailed] = useState(false);

  const banner = {
    ...defaultTrialBanner,
    ...siteConfig.trialBanner,
    image: {
      ...defaultTrialBanner.image,
      ...siteConfig.trialBanner?.image
    }
  };

  useEffect(() => {
    setImageFailed(false);
  }, [banner.image.src]);

  if (!siteConfig.trial) return null;

  return (
    <aside className="trial-banner" aria-label="Trial site notice">
      <a className="trial-banner__brand" href={banner.href} rel="noreferrer" target="_blank">
        {!imageFailed ? (
          <img
            className="trial-banner__avatar"
            src={assetPath(banner.image.src)}
            alt={banner.image.alt}
            width={34}
            height={34}
            onError={() => setImageFailed(true)}
          />
        ) : null}
        <span>{banner.text}</span>
      </a>
      <a className="trial-banner__button" href={banner.href} rel="noreferrer" target="_blank">
        {banner.buttonLabel}
      </a>
    </aside>
  );
}
