import { fireEvent, render, screen } from "@testing-library/react";
import { SiteHeader } from "@/components/SiteHeader";

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
});
