import { render, screen } from "@testing-library/react";
import { SiteFooter } from "@/components/SiteFooter";

describe("SiteFooter", () => {
  it("renders configured social media links with accessible labels", () => {
    render(<SiteFooter />);

    expect(screen.getByRole("navigation", { name: "Social media links" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Instagram" })).toHaveAttribute(
      "href",
      "https://www.instagram.com/example"
    );
    expect(screen.getByRole("link", { name: "YouTube" })).toHaveAttribute(
      "href",
      "https://www.youtube.com/@example"
    );
    expect(screen.getByRole("link", { name: "Facebook" })).toHaveAttribute(
      "href",
      "https://www.facebook.com/example"
    );
    expect(screen.getByRole("link", { name: "TikTok" })).toHaveAttribute(
      "href",
      "https://www.tiktok.com/@example"
    );
  });
});
