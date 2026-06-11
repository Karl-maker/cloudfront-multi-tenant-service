import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ConfiguredPageClient } from "@/components/ConfiguredPageClient";
import { buildSiteConfig } from "@/lib/build-site-config";
import { metadataForPage } from "@/lib/metadata";
import {
  getPageByPathFromConfig,
  resolveConfigPages,
  routePathFromSegments,
  segmentsFromRoutePath
} from "@/lib/site";
import { pageJsonLd, serializeJsonLd } from "@/lib/structured-data";

export const dynamic = "error";
export const dynamicParams = false;

type PageProps = {
  params: Promise<{
    slug?: string[];
  }>;
};

export function generateStaticParams() {
  return resolveConfigPages(buildSiteConfig).map((page) => ({
    slug: segmentsFromRoutePath(page.path)
  }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = getPageByPathFromConfig(buildSiteConfig, routePathFromSegments(slug));

  if (!page) return {};

  return metadataForPage(page);
}

export default async function ConfiguredPage({ params }: PageProps) {
  const { slug } = await params;
  const path = routePathFromSegments(slug);
  const page = getPageByPathFromConfig(buildSiteConfig, path);

  if (!page) {
    notFound();
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(pageJsonLd(page)) }} />
      <ConfiguredPageClient path={path} />
    </>
  );
}
