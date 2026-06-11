import { render, screen } from "@testing-library/react";
import { RuntimeConfigProvider } from "@/components/RuntimeConfigProvider";
import { siteConfig } from "@/lib/site";

const originalFetch = global.fetch;

describe("RuntimeConfigProvider", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      delete (global as Partial<Pick<typeof globalThis, "fetch">>).fetch;
    }
  });

  it("shows a skeleton instead of children while runtime config is loading", () => {
    Object.defineProperty(global, "fetch", {
      configurable: true,
      value: jest.fn(() => new Promise<Response>(() => {}))
    });

    render(
      <RuntimeConfigProvider initialConfig={siteConfig}>
        <div>Configured site content</div>
      </RuntimeConfigProvider>
    );

    expect(screen.getByLabelText("Loading site content")).toBeInTheDocument();
    expect(screen.queryByText("Configured site content")).not.toBeInTheDocument();
  });
});
