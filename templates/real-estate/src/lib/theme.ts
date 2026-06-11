import type { CSSProperties } from "react";
import { backgroundStyleValue } from "@/lib/site";
import type { SiteConfig } from "@/types/site";

export function runtimeThemeVariables(config: SiteConfig): CSSProperties {
  const colors = config.theme.colors;
  const background = backgroundStyleValue(config.theme.background) || colors.background;

  return {
    "--color-background": colors.background,
    "--color-surface": colors.surface,
    "--color-surface-alt": colors.surfaceAlt,
    "--color-text": colors.text,
    "--color-muted": colors.muted,
    "--color-primary": colors.primary,
    "--color-primary-contrast": colors.primaryContrast,
    "--color-accent": colors.accent,
    "--color-accent-contrast": colors.accentContrast,
    "--color-border": colors.border,
    "--font-heading": config.theme.fonts.heading,
    "--font-body": config.theme.fonts.body,
    "--radius": config.theme.radius,
    "--max-width": config.theme.maxWidth,
    "--page-background": background
  } as CSSProperties;
}

export function runtimeThemeStyle(config: SiteConfig) {
  const variables = runtimeThemeVariables(config);
  const declarations = Object.entries(variables)
    .map(([property, value]) => `${property}: ${String(value).replace(/;/g, "")} !important;`)
    .join("");
  const colorScheme = config.theme.mode === "dark" ? "dark" : "light";

  return `:root{color-scheme:${colorScheme};}body{${declarations}}`;
}
