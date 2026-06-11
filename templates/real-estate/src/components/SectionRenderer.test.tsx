import { fireEvent, render, screen } from "@testing-library/react";
import { SectionRenderer } from "@/components/SectionRenderer";
import { allPages } from "@/lib/site";

describe("SectionRenderer", () => {
  it("renders default FAQ blocks as accessible disclosure controls", () => {
    const faqPage = allPages.find((page) => page.path === "/faq/");
    const faq = faqPage?.sections.find((section) => section.type === "faq");

    render(<SectionRenderer sections={faq ? [faq] : []} />);

    expect(screen.getByRole("heading", { name: "Before you make a move" })).toBeInTheDocument();
    expect(screen.getByText("Do you support both residential and commercial property?")).toBeInTheDocument();
  });

  it("renders the default contact block with contact methods and a form", () => {
    const contact = allPages.find((page) => page.path === "/contact/");
    const section = contact?.sections.find((candidate) => candidate.type === "contact");

    render(<SectionRenderer sections={section ? [section] : []} />);

    expect(screen.getByRole("heading", { name: "Start the property conversation" })).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Start the property conversation form" })).toHaveAttribute(
      "action",
      "mailto:hello@example-realestate.com"
    );
    expect(screen.getByRole("form", { name: "Start the property conversation form" })).toHaveAttribute("enctype", "text/plain");
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Phone")).toBeInTheDocument();
    expect(screen.getByLabelText("Property need")).toBeInTheDocument();
    expect(screen.getByLabelText("Preferred location")).toBeInTheDocument();
    expect(screen.getByLabelText("Budget or target value")).toBeInTheDocument();
    expect(screen.getByLabelText("Property details")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send Inquiry" })).toBeInTheDocument();
    expect(screen.getByText("4 De Verteuil St, Woodbrook, Port of Spain, Trinidad & Tobago")).toBeInTheDocument();
    expect(screen.getByText("By appointment")).toBeInTheDocument();
  });

  it("renders the configured service cards with real estate links", () => {
    const home = allPages.find((page) => page.path === "/");
    const services = home?.sections.find((section) => section.id === "services");

    render(<SectionRenderer sections={services ? [services] : []} />);

    expect(screen.getByRole("heading", { name: "Integrated service from search to signature." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Learn more about Property Acquisition" })).toHaveAttribute(
      "href",
      "/services/property-acquisition"
    );
    expect(screen.getByText("Transaction Coordination")).toBeInTheDocument();
  });

  it("renders a configurable media gallery carousel and keeps image navigation accessible", () => {
    const home = allPages.find((page) => page.path === "/");
    const gallery = home?.sections.find((section) => section.id === "featured-gallery");

    render(<SectionRenderer sections={gallery ? [gallery] : []} />);

    expect(screen.getByRole("heading", { name: "Property imagery with room to breathe." })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Featured property imagery" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Bright residential property exterior with landscaped entry" })).toBeInTheDocument();
    expect(screen.getByText("1 / 3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next image" }));

    expect(screen.getByRole("img", { name: "Contemporary home exterior with glass and timber details" })).toBeInTheDocument();
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
  });
});
