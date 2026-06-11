import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defaultSiteConfig } from "@/lib/default-site-config";
import type { SiteConfig } from "@/types/site";

export const buildSiteConfig: SiteConfig = loadBuildSiteConfig();

function loadBuildSiteConfig(): SiteConfig {
  const configPath = process.env.SITE_CONFIG || process.env.BUILD_SITE_CONFIG;
  if (!configPath) return defaultSiteConfig;

  const resolvedPath = resolve(configPath);
  if (!existsSync(resolvedPath)) {
    throw new Error(`Build site config does not exist: ${resolvedPath}`);
  }

  return JSON.parse(readFileSync(resolvedPath, "utf8")) as SiteConfig;
}
