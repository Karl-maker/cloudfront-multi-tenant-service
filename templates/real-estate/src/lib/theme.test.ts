import { runtimeThemeStyle } from "@/lib/theme";
import { siteConfig } from "@/lib/site";

describe("runtime theme styles", () => {
  it("marks runtime CSS variables important so tenant config overrides build-time body styles", () => {
    const css = runtimeThemeStyle({
      ...siteConfig,
      theme: {
        ...siteConfig.theme,
        colors: {
          ...siteConfig.theme.colors,
          background: "#090b0f",
          text: "#f8fafc"
        }
      }
    });

    expect(css).toContain("--color-background: #090b0f !important;");
    expect(css).toContain("--color-text: #f8fafc !important;");
  });
});
