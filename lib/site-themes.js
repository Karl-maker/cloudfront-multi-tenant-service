"use strict";

const MODERN_SERVICE_CUSTOM_CSS = String.raw`.site-header{background:color-mix(in srgb,var(--color-background) 94%,transparent);backdrop-filter:blur(14px);border-bottom:1px solid var(--color-border);box-shadow:0 10px 30px rgba(15,23,42,.04)}
.site-header--at-top{position:sticky!important;top:0!important;background:color-mix(in srgb,var(--color-background) 94%,transparent)!important;border-bottom-color:var(--color-border)!important;color:var(--color-text)!important}
.site-header--at-top .site-header__link,.site-header--at-top .site-header__brand{color:inherit!important}.site-header--at-top .button--primary{background:var(--color-primary)!important;color:var(--color-primary-contrast)!important}.site-header--at-top .site-header__logo{filter:none}
.site-header__inner{min-height:76px}.site-header__brand{font-size:1rem;font-weight:820}.site-header__mark{border-radius:8px;background:linear-gradient(135deg,var(--color-primary),#0f766e)}
.site-header__link{border-radius:8px;font-size:.93rem;font-weight:740}.site-header__link:hover,.site-header__link:focus-visible{background:var(--color-surface-alt);color:var(--color-primary)}
.button{min-height:46px;border-radius:8px;font-size:.94rem;font-weight:820;letter-spacing:0;box-shadow:none}.button--primary{background:var(--color-primary);box-shadow:0 14px 30px rgba(37,99,235,.2)}.button--secondary{border-color:color-mix(in srgb,var(--color-primary) 28%,var(--color-border));background:var(--color-surface);color:var(--color-primary)}.button--text{color:var(--color-primary)}
.section{padding:84px 0}.section:first-child{padding-top:34px}
.section--hero:first-child{min-height:640px;display:grid;align-items:center;padding:76px 0;background-position:center;background-size:cover;color:#fff}
.section--hero:first-child::before{background:linear-gradient(90deg,rgba(12,18,32,.76),rgba(12,18,32,.44) 52%,rgba(12,18,32,.16))}
.section--hero:first-child h1,.section--hero:first-child p,.section--hero:first-child .kicker{color:#fff}
.section--hero:first-child .hero{display:grid;grid-template-columns:minmax(0,1fr);max-width:780px}.section--hero:first-child .hero__copy{gap:18px}.section--hero:first-child h1{max-width:14ch;font-size:clamp(2.65rem,5.8vw,5.5rem);line-height:.98;font-weight:850}.section--hero:first-child .hero__body{max-width:620px;font-size:1.12rem}
.hero{gap:56px}.hero:not(.hero--centered){grid-template-columns:minmax(0,1fr) minmax(360px,.9fr)}.media-frame,.hero-carousel__stage{border-radius:8px;box-shadow:0 24px 60px rgba(15,23,42,.12)}
h1,h2,h3{font-family:var(--font-heading);font-weight:850}h2{max-width:16ch;font-size:clamp(2rem,3.8vw,3.6rem);line-height:1}.kicker{color:var(--color-primary);font-weight:860;letter-spacing:.12em}
.content-card{padding:26px;border:1px solid var(--color-border);border-radius:8px;background:var(--color-surface);box-shadow:0 18px 48px rgba(15,23,42,.06)}.content-card h3{font-size:1.22rem}.text-link{color:var(--color-primary);font-weight:820}
.hero-stats,.stat-grid{border:1px solid var(--color-border);border-radius:8px;background:var(--color-surface);box-shadow:0 18px 48px rgba(15,23,42,.06)}.hero-stats div,.stat-grid div{padding:22px 24px;background:transparent}.hero-stats dd,.stat-grid dd{font-family:var(--font-heading);font-weight:850}.section--hero:first-child .hero-stats{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.24);box-shadow:none}.section--hero:first-child .hero-stats dt,.section--hero:first-child .hero-stats dd{color:#fff!important}
.pricing-card,.testimonial-card,.timeline__item,.contact-method{border-radius:8px;background:var(--color-surface);box-shadow:0 18px 48px rgba(15,23,42,.06)}.pricing-card{border-color:var(--color-border)}.pricing-card__price{color:var(--color-primary)}.contact-method{padding:18px 20px;border:1px solid var(--color-border)}
.map-layout{padding:28px;border:1px solid var(--color-border);border-radius:8px;background:var(--color-surface);box-shadow:0 18px 48px rgba(15,23,42,.06)}.map-frame{border-radius:8px}
.cta-band{border-radius:8px;background:linear-gradient(135deg,var(--color-primary),#0f766e);color:var(--color-primary-contrast);box-shadow:0 24px 60px rgba(37,99,235,.22)}.cta-band h2,.cta-band p,.cta-band .kicker{color:var(--color-primary-contrast)}
.section--mediaGallery .hero-carousel__stage{aspect-ratio:16/10}.section--mediaGallery .hero-carousel__stage img{object-fit:cover}.section--mediaGallery .hero-carousel figcaption{font-size:1rem;font-weight:740}.site-footer__social-link{border-radius:999px}
.section--hero.page-hero:first-child{min-height:430px;padding:92px 0 64px;align-items:center}.section--hero.page-hero:first-child .hero{display:block;max-width:780px}.section--hero.page-hero:first-child h1{max-width:15ch;font-size:clamp(2.35rem,4.8vw,4.4rem)}.section--hero.page-hero:first-child .hero__body{max-width:650px}
@media (max-width:900px){.hero:not(.hero--centered){grid-template-columns:1fr}.section{padding:68px 0}.section--hero:first-child{min-height:620px;padding:64px 0}.section--hero:first-child h1{font-size:clamp(2.45rem,12vw,4.4rem)}}
@media (max-width:760px){.site-header__inner{min-height:70px}.section:first-child{padding-top:22px}.section--hero:first-child{min-height:590px}.button{width:100%}.map-layout{padding:20px}.contact-method{padding:16px 18px}.section--hero.page-hero:first-child{min-height:420px;padding:76px 0 48px}}`;

const THEMES = {
  luxury: {
    label: "Modern Service",
    description: "Modern generic service-business base: clean sans typography, sticky header, rounded cards, clear booking CTAs.",
    theme: {
      mode: "light",
      colors: {
        background: "#f8fafc",
        surface: "#ffffff",
        surfaceAlt: "#eef4ff",
        text: "#111827",
        muted: "#64748b",
        primary: "#2563eb",
        primaryContrast: "#ffffff",
        accent: "#14b8a6",
        accentContrast: "#042f2e",
        border: "#dbe5f0"
      },
      fonts: {
        heading: "Inter, ui-sans-serif, system-ui, sans-serif",
        body: "Inter, ui-sans-serif, system-ui, sans-serif"
      },
      radius: "8px",
      maxWidth: "1180px",
      background: {
        type: "solid",
        value: "#f8fafc"
      },
      customCss: MODERN_SERVICE_CUSTOM_CSS
    }
  }
};

function listThemes() {
  return Object.entries(THEMES).map(([name, preset]) => ({
    name,
    label: preset.label,
    description: preset.description
  }));
}

function getTheme(name = "luxury") {
  const key = String(name || "luxury").trim().toLowerCase();
  const preset = THEMES[key];
  if (!preset) {
    throw new Error(`Unknown theme "${name}". Available themes: ${Object.keys(THEMES).join(", ")}`);
  }
  return JSON.parse(JSON.stringify(preset.theme));
}

module.exports = {
  getTheme,
  listThemes
};
