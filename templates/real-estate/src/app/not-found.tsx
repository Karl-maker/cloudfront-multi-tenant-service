import { SmartLink } from "@/components/SmartLink";
import { siteConfig } from "@/lib/site";

export default function NotFound() {
  return (
    <main id="main" className="not-found">
      <div className="not-found__inner">
        <p className="kicker">404</p>
        <h1>Page not found</h1>
        <p>{siteConfig.site.name} does not have a static page for this route.</p>
        <SmartLink className="button button--primary" href="/">
          Go home
        </SmartLink>
      </div>
    </main>
  );
}

