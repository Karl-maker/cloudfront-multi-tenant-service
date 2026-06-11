"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Star } from "lucide-react";
import { assetPath, backgroundStyleValue } from "@/lib/site";
import type { SiteAction, SiteImage, SiteSection } from "@/types/site";
import { SmartLink } from "@/components/SmartLink";

interface SectionRendererProps {
  sections: SiteSection[];
}

const defaultContactFields = [
  {
    name: "name",
    label: "Name",
    type: "text",
    autoComplete: "name",
    required: true
  },
  {
    name: "email",
    label: "Email",
    type: "email",
    autoComplete: "email",
    required: true
  },
  {
    name: "message",
    label: "Message",
    type: "textarea",
    rows: 5,
    required: true
  }
] satisfies NonNullable<NonNullable<SiteSection["form"]>["fields"]>;

export function SectionRenderer({ sections }: SectionRendererProps) {
  return (
    <>
      {sections.map((section) => (
        <Section key={section.id} section={section} />
      ))}
    </>
  );
}

function Section({ section }: { section: SiteSection }) {
  switch (section.type) {
    case "hero":
      return <HeroSection section={section} />;
    case "mediaGallery":
      return <MediaGallerySection section={section} />;
    case "rates":
      return <RatesSection section={section} />;
    case "amenities":
      return <AmenitiesSection section={section} />;
    case "location":
      return <LocationSection section={section} />;
    case "featureGrid":
      return <GridSection section={section} className="feature-grid" />;
    case "cardGrid":
      return <GridSection section={section} className="card-grid" />;
    case "split":
      return <SplitSection section={section} />;
    case "stats":
      return <StatsSection section={section} />;
    case "timeline":
      return <TimelineSection section={section} />;
    case "faq":
      return <FaqSection section={section} />;
    case "testimonials":
      return <TestimonialsSection section={section} />;
    case "cta":
      return <CtaSection section={section} />;
    case "richText":
      return <RichTextSection section={section} />;
    case "logoCloud":
      return <LogoCloudSection section={section} />;
    case "contact":
      return <ContactSection section={section} />;
    default:
      return null;
  }
}

function SectionShell({
  section,
  children,
  narrow = false
}: {
  section: SiteSection;
  children: ReactNode;
  narrow?: boolean;
}) {
  const background = backgroundStyleValue(section.background);
  const style = background
    ? ({
        background,
        backgroundPosition: section.background?.type === "image" ? "center" : undefined,
        backgroundSize: section.background?.type === "image" ? "cover" : undefined
      } as CSSProperties)
    : undefined;

  return (
    <section
      id={section.id}
      className={[
        "section",
        `section--${section.type}`,
        section.variant ? `section--${section.variant}` : "",
        section.className || ""
      ]
        .filter(Boolean)
        .join(" ")}
      style={style}
    >
      <div className={narrow ? "section__inner section__inner--narrow" : "section__inner"}>{children}</div>
    </section>
  );
}

function SectionIntro({ section, centered = false }: { section: SiteSection; centered?: boolean }) {
  if (!section.kicker && !section.title && !section.body) return null;

  return (
    <div className={centered ? "section-intro section-intro--centered" : "section-intro"}>
      {section.kicker ? <p className="kicker">{section.kicker}</p> : null}
      {section.title ? <h2>{section.title}</h2> : null}
      {section.body ? <p>{section.body}</p> : null}
    </div>
  );
}

function HeroSection({ section }: { section: SiteSection }) {
  const centered = section.variant === "centered";
  const mediaFirst = section.variant === "mediaLeft";
  const mediaItems = useMemo(() => {
    if (section.carousel?.enabled === false) return [];
    if (section.mediaItems?.length) return section.mediaItems;
    return [];
  }, [section.carousel?.enabled, section.mediaItems]);
  const hasCarousel = mediaItems.length > 0;

  return (
    <SectionShell section={section}>
      <div
        className={[
          "hero",
          centered ? "hero--centered" : "",
          mediaFirst ? "hero--media-first" : "",
          hasCarousel ? "hero--with-carousel" : ""
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="hero__copy">
          {section.kicker ? <p className="kicker">{section.kicker}</p> : null}
          {section.title ? <h1>{section.title}</h1> : null}
          {section.body ? <p className="hero__body">{section.body}</p> : null}
          {section.badges?.length ? (
            <ul className="badge-list" aria-label="Highlights">
              {section.badges.map((badge) => (
                <li key={badge}>{badge}</li>
              ))}
            </ul>
          ) : null}
          <Actions actions={section.actions} />
        </div>
        {hasCarousel ? (
          <HeroCarousel section={section} items={mediaItems} />
        ) : section.media ? (
          <MediaBlock media={section.media} priority />
        ) : null}
      </div>
      {section.stats?.length ? (
        <dl className="hero-stats">
          {section.stats.map((stat) => (
            <div key={`${stat.value}-${stat.label}`}>
              <dt>{stat.label}</dt>
              <dd>{stat.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </SectionShell>
  );
}

function HeroCarousel({ section, items }: { section: SiteSection; items: SiteImage[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const hasMultipleImages = items.length > 1;
  const activeItem = items[activeIndex] || items[0];
  const label = section.carousel?.label || "Hero image gallery";
  const autoPlay = section.carousel?.autoPlay !== false;
  const intervalMs = Math.max(2500, section.carousel?.intervalMs || 6000);

  useEffect(() => {
    setActiveIndex(0);
  }, [items]);

  useEffect(() => {
    if (!hasMultipleImages || !autoPlay) return undefined;

    const interval = window.setInterval(() => {
      setActiveIndex((currentIndex) => (currentIndex + 1) % items.length);
    }, intervalMs);

    return () => window.clearInterval(interval);
  }, [autoPlay, hasMultipleImages, intervalMs, items.length]);

  if (!activeItem) return null;

  const goToPrevious = () => {
    setActiveIndex((currentIndex) => (currentIndex - 1 + items.length) % items.length);
  };

  const goToNext = () => {
    setActiveIndex((currentIndex) => (currentIndex + 1) % items.length);
  };

  return (
    <figure className="hero-carousel" aria-label={label} aria-roledescription="carousel" role="region">
      <div className="hero-carousel__stage">
        <MediaElement media={activeItem} priority />
        {hasMultipleImages ? (
          <div className="hero-carousel__controls">
            <button aria-label="Previous image" onClick={goToPrevious} type="button">
              Prev
            </button>
            <span aria-live="polite">
              {activeIndex + 1} / {items.length}
            </span>
            <button aria-label="Next image" onClick={goToNext} type="button">
              Next
            </button>
          </div>
        ) : null}
      </div>
      {activeItem.caption ? <figcaption>{activeItem.caption}</figcaption> : null}
      {hasMultipleImages ? (
        <div className="hero-carousel__thumbs" aria-label="Choose hero image" role="tablist">
          {items.map((item, index) => (
            <button
              aria-label={`Show image ${index + 1}: ${item.alt}`}
              aria-selected={index === activeIndex}
              key={`${item.src}-${index}`}
              onClick={() => setActiveIndex(index)}
              role="tab"
              type="button"
            >
              {thumbnailSrc(item) ? (
                <img alt="" aria-hidden="true" decoding="async" src={assetPath(thumbnailSrc(item) || "")} />
              ) : (
                <span aria-hidden="true">{mediaType(item) === "video" ? "Video" : "Media"}</span>
              )}
            </button>
          ))}
        </div>
      ) : null}
    </figure>
  );
}

function MediaGallerySection({ section }: { section: SiteSection }) {
  const mediaItems = section.mediaItems?.length ? section.mediaItems : section.media ? [section.media] : [];

  if (!mediaItems.length || section.carousel?.enabled === false) return null;

  return (
    <SectionShell section={section}>
      <SectionIntro section={section} centered />
      <HeroCarousel section={section} items={mediaItems} />
    </SectionShell>
  );
}

function RatesSection({ section }: { section: SiteSection }) {
  return (
    <SectionShell section={section}>
      <SectionIntro section={section} centered />
      <div className="rates-grid">
        {section.items?.map((item, index) => (
          <article
            className={item.featured ? "rate-card rate-card--featured" : "rate-card"}
            key={`${item.title}-${index}`}
          >
            {item.label ? <p className="kicker">{item.label}</p> : null}
            {item.title ? <h3>{item.title}</h3> : null}
            {item.price ? (
              <p className="rate-card__price">
                <strong>{item.price}</strong>
                {item.period ? <span>{item.period}</span> : null}
              </p>
            ) : null}
            {item.body ? <p>{item.body}</p> : null}
            {item.amenities?.length ? (
              <ul className="check-list">
                {item.amenities.map((amenity) => (
                  <li key={amenity}>{amenity}</li>
                ))}
              </ul>
            ) : null}
            {item.href ? (
              <SmartLink className="button button--primary" href={item.href}>
                View details
              </SmartLink>
            ) : null}
          </article>
        ))}
      </div>
    </SectionShell>
  );
}

function AmenitiesSection({ section }: { section: SiteSection }) {
  return (
    <SectionShell section={section}>
      <SectionIntro section={section} centered />
      <div
        className="amenities-grid"
        style={{ "--grid-columns": String(section.columns || 4) } as CSSProperties}
      >
        {section.items?.map((item, index) => (
          <article className="amenity-item" key={`${item.title || item.label}-${index}`}>
            {item.icon ? <span className="amenity-item__icon" aria-hidden="true">{item.icon}</span> : null}
            {item.title ? <h3>{item.title}</h3> : null}
            {item.body ? <p>{item.body}</p> : null}
          </article>
        ))}
      </div>
    </SectionShell>
  );
}

function LocationSection({ section }: { section: SiteSection }) {
  const mapTitle = section.map?.title || `${section.title || "Location"} map`;
  const query = section.map?.query || section.map?.address || section.title || "";
  const mapSrc =
    section.map?.embedUrl ||
    (query ? `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed` : undefined);

  return (
    <SectionShell section={section}>
      <div className="location-layout">
        <div className="location-layout__copy">
          <SectionIntro section={section} />
          {section.map?.address ? <p className="location-layout__address">{section.map.address}</p> : null}
          {section.methods?.length ? (
            <div className="contact-methods">
              {section.methods.map((method) => {
                const content = (
                  <>
                    <span>{method.label}</span>
                    <strong>{method.value}</strong>
                  </>
                );

                return method.href ? (
                  <SmartLink key={method.label} className="contact-method" href={method.href}>
                    {content}
                  </SmartLink>
                ) : (
                  <div key={method.label} className="contact-method">
                    {content}
                  </div>
                );
              })}
            </div>
          ) : null}
          <Actions actions={section.actions} />
        </div>
        {mapSrc ? (
          <iframe
            allowFullScreen
            className="location-map"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            src={mapSrc}
            title={mapTitle}
          />
        ) : null}
      </div>
    </SectionShell>
  );
}

function GridSection({ section, className }: { section: SiteSection; className: string }) {
  return (
    <SectionShell section={section}>
      <SectionIntro section={section} centered />
      <div
        className={className}
        style={{ "--grid-columns": String(section.columns || 3) } as CSSProperties}
      >
        {section.items?.map((item, index) => (
          <article className="content-card" key={`${item.title || item.label}-${index}`}>
            {item.media ? (
              <div className="content-card__image">
                <MediaElement media={item.media} />
              </div>
            ) : null}
            {item.label ? <p className="kicker">{item.label}</p> : null}
            {item.title ? <h3>{item.title}</h3> : null}
            {item.body ? <p>{item.body}</p> : null}
            {item.href ? (
              <SmartLink
                aria-label={item.title ? `Learn more about ${item.title}` : undefined}
                className="text-link"
                href={item.href}
              >
                Learn more
              </SmartLink>
            ) : null}
          </article>
        ))}
      </div>
    </SectionShell>
  );
}

function SplitSection({ section }: { section: SiteSection }) {
  const mediaFirst = section.variant === "mediaLeft";

  return (
    <SectionShell section={section}>
      <div className={mediaFirst ? "split split--media-first" : "split"}>
        {section.media ? <MediaBlock media={section.media} /> : null}
        <div className="split__copy">
          <SectionIntro section={section} />
          {section.bullets?.length ? (
            <ul className="check-list">
              {section.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          ) : null}
          <Actions actions={section.actions} />
        </div>
      </div>
    </SectionShell>
  );
}

function StatsSection({ section }: { section: SiteSection }) {
  return (
    <SectionShell section={section} narrow>
      <dl className="stat-grid">
        {section.items?.map((item, index) => (
          <div key={`${item.value}-${index}`}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
    </SectionShell>
  );
}

function TimelineSection({ section }: { section: SiteSection }) {
  return (
    <SectionShell section={section}>
      <SectionIntro section={section} centered />
      <div className="timeline">
        {section.items?.map((item, index) => (
          <article className="timeline__item" key={`${item.title}-${index}`}>
            <span className="timeline__number">{String(index + 1).padStart(2, "0")}</span>
            {item.title ? <h3>{item.title}</h3> : null}
            {item.body ? <p>{item.body}</p> : null}
          </article>
        ))}
      </div>
    </SectionShell>
  );
}

function FaqSection({ section }: { section: SiteSection }) {
  return (
    <SectionShell section={section} narrow>
      <SectionIntro section={section} centered />
      <div className="faq-list">
        {section.items?.map((item, index) => (
          <FaqItem item={item} key={`${item.question}-${index}`} />
        ))}
      </div>
    </SectionShell>
  );
}

function FaqItem({ item }: { item: NonNullable<SiteSection["items"]>[number] }) {
  return (
    <details>
      <summary>{item.question || item.title}</summary>
      {item.answer ? <p>{item.answer}</p> : null}
      {item.body ? <p>{item.body}</p> : null}
      {item.children?.length ? (
        <div className="faq-list faq-list--nested">
          {item.children.map((child, index) => (
            <FaqItem item={child} key={`${child.question || child.title}-${index}`} />
          ))}
        </div>
      ) : null}
    </details>
  );
}

function TestimonialsSection({ section }: { section: SiteSection }) {
  return (
    <SectionShell section={section}>
      <SectionIntro section={section} centered />
      <div
        className="testimonials-grid"
        style={{ "--grid-columns": String(section.columns || 3) } as CSSProperties}
      >
        {section.items?.map((item, index) => {
          const rating = Math.max(0, Math.min(5, Math.round(item.rating || 5)));
          const byline = [item.role, item.location].filter(Boolean).join(" / ");

          return (
            <figure className="testimonial-card" key={`${item.name || item.title}-${index}`}>
              <div className="testimonial-card__stars" aria-label={`${rating} out of 5 stars`}>
                {Array.from({ length: 5 }).map((_, starIndex) => (
                  <Star
                    aria-hidden="true"
                    className={starIndex < rating ? "testimonial-card__star testimonial-card__star--filled" : "testimonial-card__star"}
                    fill="currentColor"
                    key={starIndex}
                    strokeWidth={2}
                  />
                ))}
              </div>
              {item.body ? <blockquote>{item.body}</blockquote> : null}
              <figcaption>
                <strong>{item.name || item.title}</strong>
                {byline ? <span>{byline}</span> : null}
              </figcaption>
            </figure>
          );
        })}
      </div>
    </SectionShell>
  );
}

function CtaSection({ section }: { section: SiteSection }) {
  return (
    <SectionShell section={section} narrow>
      <div className="cta-band">
        <SectionIntro section={section} centered />
        <Actions actions={section.actions} centered />
      </div>
    </SectionShell>
  );
}

function RichTextSection({ section }: { section: SiteSection }) {
  return (
    <SectionShell section={section} narrow>
      <article className="rich-text">
        <SectionIntro section={section} />
        {section.content?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      </article>
    </SectionShell>
  );
}

function LogoCloudSection({ section }: { section: SiteSection }) {
  return (
    <SectionShell section={section}>
      <SectionIntro section={section} centered />
      <ul className="logo-cloud">
        {section.items?.map((item, index) => (
          <li key={`${item.label || item.title}-${index}`}>{item.label || item.title}</li>
        ))}
      </ul>
    </SectionShell>
  );
}

function ContactSection({ section }: { section: SiteSection }) {
  return (
    <SectionShell section={section}>
      <div className="contact-layout">
        <div>
          <SectionIntro section={section} />
          <div className="contact-methods">
            {section.methods?.map((method) => {
              const content = (
                <>
                  <span>{method.label}</span>
                  <strong>{method.value}</strong>
                </>
              );

              return method.href ? (
                <SmartLink key={method.label} className="contact-method" href={method.href}>
                  {content}
                </SmartLink>
              ) : (
                <div key={method.label} className="contact-method">
                  {content}
                </div>
              );
            })}
          </div>
        </div>
        {section.form?.enabled ? <ContactForm section={section} /> : null}
      </div>
    </SectionShell>
  );
}

function ContactForm({ section }: { section: SiteSection }) {
  const fields = section.form?.fields?.length ? section.form.fields : defaultContactFields;

  return (
    <form
      aria-label={section.title ? `${section.title} form` : "Contact form"}
      className="contact-form"
      action={section.form?.action}
      encType={section.form?.encType}
      method={section.form?.method || "POST"}
    >
      {fields.map((field) => (
        <ContactField key={field.name} field={field} />
      ))}
      <button className="button button--primary" type="submit">
        {section.form?.submitLabel || "Send message"}
      </button>
    </form>
  );
}

function ContactField({ field }: { field: NonNullable<NonNullable<SiteSection["form"]>["fields"]>[number] }) {
  const type = field.type || "text";

  if (type === "textarea") {
    return (
      <label>
        {field.label}
        <textarea
          name={field.name}
          placeholder={field.placeholder}
          required={field.required}
          rows={field.rows || 5}
        />
      </label>
    );
  }

  if (type === "select") {
    return (
      <label>
        {field.label}
        <select name={field.name} required={field.required} defaultValue="">
          {field.placeholder ? (
            <option value="" disabled>
              {field.placeholder}
            </option>
          ) : null}
          {field.options?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <label>
      {field.label}
      <input
        name={field.name}
        type={type}
        autoComplete={field.autoComplete}
        placeholder={field.placeholder}
        required={field.required}
      />
    </label>
  );
}

function Actions({ actions, centered = false }: { actions?: SiteAction[]; centered?: boolean }) {
  if (!actions?.length) return null;

  return (
    <div className={centered ? "action-row action-row--centered" : "action-row"}>
      {actions.map((action) => (
        <SmartLink key={`${action.label}-${action.href}`} className={`button button--${action.style || "primary"}`} href={action.href}>
          {action.label}
        </SmartLink>
      ))}
    </div>
  );
}

function MediaBlock({ media, priority = false }: { media: SiteImage; priority?: boolean }) {
  return (
    <figure className="media-frame">
      <MediaElement media={media} priority={priority} />
      {media.caption ? <figcaption>{media.caption}</figcaption> : null}
    </figure>
  );
}

function MediaElement({ media, priority = false }: { media: SiteImage; priority?: boolean }) {
  const type = mediaType(media);

  if (type === "video") {
    return (
      <video
        aria-label={media.alt}
        autoPlay={media.autoplay}
        controls={media.controls ?? true}
        loop={media.loop}
        muted={media.muted ?? media.autoplay}
        playsInline
        poster={media.poster ? assetPath(media.poster) : undefined}
        preload="metadata"
        src={assetPath(media.src)}
      />
    );
  }

  if (type === "embed") {
    return (
      <iframe
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        loading="lazy"
        src={media.src}
        title={media.title || media.alt}
      />
    );
  }

  return (
    <img
      alt={media.alt}
      decoding="async"
      fetchPriority={priority ? "high" : "auto"}
      src={assetPath(media.src)}
    />
  );
}

function mediaType(media: SiteImage) {
  if (media.type) return media.type;
  if (/\.(mp4|webm|ogg)(\?|#|$)/i.test(media.src)) return "video";
  if (/youtube\.com|youtu\.be|vimeo\.com/.test(media.src)) return "embed";
  return "image";
}

function thumbnailSrc(media: SiteImage) {
  if (media.poster) return media.poster;
  return mediaType(media) === "image" ? media.src : undefined;
}
