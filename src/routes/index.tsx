import { createFileRoute } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/SiteLayout";
import { Hero } from "@/components/site/Hero";
import { AboutSection } from "@/components/site/AboutSection";
import { ServicesSection } from "@/components/site/ServicesSection";
import { WhyChooseUs } from "@/components/site/WhyChooseUs";
import { TrustPlaceholders } from "@/components/site/TrustPlaceholders";
import { BlogSection } from "@/components/site/BlogSection";
import { GallerySection } from "@/components/site/GallerySection";
import { Testimonials } from "@/components/site/Testimonials";
import { FaqSection } from "@/components/site/FaqSection";
import { FleetSection } from "@/components/site/FleetSection";
import { buildSeoHead } from "@/services/seoService";
import { buildVideoObjectSchema, buildVideoOgMeta, SITE_VIDEOS } from "@/lib/videos";
import { SITE_ORIGIN } from "@/lib/site";

export const Route = createFileRoute("/")({
  head: () => {
    const seo = buildSeoHead("home", "/");
    const heroVideo = SITE_VIDEOS[0]!;
    return {
      ...seo,
      meta: [...(seo.meta ?? []), ...buildVideoOgMeta(heroVideo, SITE_ORIGIN)],
      links: [
        ...(seo.links ?? []),
        {
          rel: "preload",
          as: "image",
          href: "/images/hero/hero-main.webp",
          type: "image/webp",
          fetchPriority: "high",
        },
        // Helps crawlers discover the hero MP4 even before the delayed <video> mounts.
        {
          rel: "alternate",
          type: "video/mp4",
          href: heroVideo.contentPath,
          title: `${heroVideo.title.en}`,
        },
      ],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify(buildVideoObjectSchema(heroVideo, SITE_ORIGIN)),
        },
      ],
    };
  },
  component: HomePage,
});

function HomePage() {
  return (
    <SiteLayout>
      <Hero />
      <AboutSection variant="home" />
      <ServicesSection variant="home" />
      <WhyChooseUs variant="home" />
      <TrustPlaceholders />
      <FleetSection limit={3} />
      <BlogSection limit={3} />
      <GallerySection limit={5} />
      <Testimonials />
      <FaqSection variant="home" />
    </SiteLayout>
  );
}
