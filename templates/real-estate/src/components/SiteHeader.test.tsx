import { fireEvent, render, screen } from "@testing-library/react";
import { RuntimeConfigProvider } from "@/components/RuntimeConfigProvider";
import { SiteHeader } from "@/components/SiteHeader";
import { siteConfig } from "@/lib/site";

describe("SiteHeader", () => {
  it("toggles the mobile navigation panel and closes it after link selection", () => {
    render(<SiteHeader />);

    expect(screen.getByRole("link", { name: "Aurum Realty Group home" })).toBeInTheDocument();
    expect(screen.queryByText("Aurum Realty")).not.toBeInTheDocument();

    const openButton = screen.getByRole("button", { name: "Open menu" });
    const panel = screen.getByRole("navigation", { name: "Primary navigation" }).parentElement;

    expect(openButton).toHaveAttribute("aria-expanded", "false");
    expect(panel).not.toHaveClass("site-header__panel--open");

    fireEvent.click(openButton);

    expect(screen.getByRole("button", { name: "Close menu" })).toHaveAttribute("aria-expanded", "true");
    expect(panel).toHaveClass("site-header__panel--open");

    fireEvent.click(screen.getByRole("link", { name: "Contact" }));

    expect(screen.getByRole("button", { name: "Open menu" })).toHaveAttribute("aria-expanded", "false");
    expect(panel).not.toHaveClass("site-header__panel--open");
  });

  it("renders a text brand when no logo image is configured", async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn(() => Promise.reject(new Error("No runtime config"))) as jest.Mock;

    render(
      <RuntimeConfigProvider
        initialConfig={{
          ...siteConfig,
          navigation: {
            ...siteConfig.navigation,
            logo: undefined,
            logoText: "Text Brand"
          }
        }}
      >
        <SiteHeader />
      </RuntimeConfigProvider>
    );

    expect(await screen.findByRole("link", { name: "Aurum Realty Group home" })).toBeInTheDocument();
    expect(screen.getByText("Text Brand")).toBeInTheDocument();

    global.fetch = originalFetch;
  });
});
