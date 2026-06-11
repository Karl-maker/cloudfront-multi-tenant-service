import { render, screen } from "@testing-library/react";
import { TrialBanner } from "@/components/TrialBanner";

describe("TrialBanner", () => {
  it("renders the configured trial attribution banner", () => {
    render(<TrialBanner />);

    expect(screen.getByRole("complementary", { name: "Trial site notice" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "SyncPoly icon" })).toHaveAttribute(
      "src",
      "https://d1mp8fjhswh27j.cloudfront.net/assets/syncpoly-icon.png"
    );
    expect(screen.getByRole("link", { name: "Check us out" })).toHaveAttribute("href", "https://www.syncpoly.com");
    expect(screen.getByText("This site was built with SyncPoly.")).toBeInTheDocument();
  });
});
