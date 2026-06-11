export type ActionStyle = "primary" | "secondary" | "text";
export type ThemeMode = "light" | "dark";
export type BackgroundType = "solid" | "gradient" | "image";
export type ContactFieldType = "text" | "email" | "tel" | "textarea" | "select";
export type MediaType = "image" | "video" | "embed";
export type SectionType =
  | "hero"
  | "mediaGallery"
  | "rates"
  | "amenities"
  | "location"
  | "featureGrid"
  | "split"
  | "cardGrid"
  | "stats"
  | "timeline"
  | "faq"
  | "testimonials"
  | "cta"
  | "richText"
  | "logoCloud"
  | "contact";

export interface SiteConfig {
  deployment?: {
    basePath?: string;
    assetPrefix?: string;
  };
  trial?: boolean;
  trialBanner?: {
    text?: string;
    href?: string;
    image?: SiteImage;
    buttonLabel?: string;
  };
  site: {
    name: string;
    shortName: string;
    url: string;
    locale: string;
    description: string;
    updatedAt?: string;
    keywords?: string[];
    author?: {
      name?: string;
      url?: string;
    };
    social?: {
      twitterHandle?: string;
      sameAs?: string[];
    };
    manifest?: {
      display?: string;
      orientation?: string;
      backgroundColor?: string;
      themeColor?: string;
      icon?: string;
      categories?: string[];
      screenshots?: Array<{
        src: string;
        sizes: string;
        type: string;
        formFactor?: string;
        label?: string;
      }>;
      shortcuts?: Array<{
        name: string;
        shortName?: string;
        description?: string;
        url: string;
        icon?: string;
      }>;
      preferRelatedApplications?: boolean;
    };
    pwa?: {
      enabled?: boolean;
      serviceWorker?: string;
      offlinePath?: string;
      cacheName?: string;
    };
    llms?: {
      summary?: string;
      notes?: string[];
    };
  };
  seo: {
    titleTemplate?: string;
    defaultTitle: string;
    defaultImage: string;
    robots?: {
      index?: boolean;
      follow?: boolean;
      allow?: string[];
      disallow?: string[];
    };
    structuredData?: JsonObject;
  };
  theme: {
    mode?: ThemeMode;
    colors: Record<string, string>;
    fonts: {
      heading?: string;
      body?: string;
    };
    radius: string;
    maxWidth: string;
    background?: BackgroundConfig;
    customCss?: string;
  };
  navigation: {
    logoText: string;
    logo?: SiteImage;
    links: SiteLink[];
    cta?: SiteAction;
  };
  blocks?: Record<string, SiteSection>;
  pages: SitePage[];
  footer: {
    tagline?: string;
    links?: SiteLink[];
    socialLinks?: FooterSocialLink[];
    copyright?: string;
  };
}

export interface SitePage {
  path: string;
  title: string;
  layout?: string;
  description: string;
  background?: BackgroundConfig;
  seo?: {
    title?: string;
    description?: string;
    image?: string;
    keywords?: string[];
    structuredData?: JsonObject;
  };
  sections: SiteSectionInput[];
}

export interface SiteLink {
  label: string;
  href: string;
}

export interface FooterSocialLink extends SiteLink {
  platform: string;
}

export interface SiteAction extends SiteLink {
  style?: ActionStyle;
}

export interface SiteImage {
  type?: MediaType;
  src: string;
  alt: string;
  caption?: string;
  poster?: string;
  title?: string;
  autoplay?: boolean;
  controls?: boolean;
  muted?: boolean;
  loop?: boolean;
}

export interface SiteCarousel {
  enabled?: boolean;
  autoPlay?: boolean;
  intervalMs?: number;
  label?: string;
}

export interface BackgroundConfig {
  type: BackgroundType;
  value: string;
  overlay?: string;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface SiteSection {
  id: string;
  type: SectionType;
  className?: string;
  kicker?: string;
  title?: string;
  body?: string;
  variant?: string;
  columns?: number;
  background?: BackgroundConfig;
  media?: SiteImage;
  mediaItems?: SiteImage[];
  carousel?: SiteCarousel;
  map?: {
    embedUrl?: string;
    query?: string;
    title?: string;
    address?: string;
    latitude?: number;
    longitude?: number;
    zoom?: number;
  };
  actions?: SiteAction[];
  badges?: string[];
  stats?: Array<{
    label: string;
    value: string;
  }>;
  bullets?: string[];
  content?: string[];
  items?: Array<{
    title?: string;
    body?: string;
    label?: string;
    value?: string;
    question?: string;
    answer?: string;
    href?: string;
    media?: SiteImage;
    rating?: number;
    name?: string;
    role?: string;
    location?: string;
    price?: string;
    period?: string;
    featured?: boolean;
    icon?: string;
    children?: SiteSection["items"];
    amenities?: string[];
  }>;
  methods?: Array<{
    label: string;
    value: string;
    href?: string;
  }>;
  form?: {
    enabled?: boolean;
    action?: string;
    method?: string;
    encType?: string;
    submitLabel?: string;
    fields?: Array<{
      name: string;
      label: string;
      type?: ContactFieldType;
      placeholder?: string;
      required?: boolean;
      autoComplete?: string;
      rows?: number;
      options?: string[];
    }>;
  };
}

export interface SiteSectionReference extends Partial<SiteSection> {
  use: string;
}

export type SiteSectionInput = SiteSection | SiteSectionReference;
