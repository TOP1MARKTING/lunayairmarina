import { Link, createFileRoute } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/SiteLayout";
import { PageHeader } from "@/components/site/PageHeader";
import { WhyChooseUs } from "@/components/site/WhyChooseUs";
import { FleetSection } from "@/components/site/FleetSection";
import { Reveal } from "@/components/shared/Reveal";
import { Counter } from "@/components/shared/Counter";
import { useLanguage } from "@/lib/i18n";
import { buildSeoHead } from "@/services/seoService";
import { usePageHeaderImage } from "@/hooks/usePageHeaderImage";
import aboutHeader from "@/assets/headers/header-about.jpg";
import aboutImage from "@/assets/about/yacht_side_transom_landscape.png";

export const Route = createFileRoute("/about")({
  head: () => buildSeoHead("about", "/about"),
  component: AboutPage,
});

interface Stat {
  value: number;
  suffix: string;
  label: string;
}

interface ValueItem {
  title: string;
  description: string;
}

function AboutPage() {
  const { t, tv } = useLanguage();
  const headerImage = usePageHeaderImage("about", aboutHeader);
  const stats = tv<Stat[]>("about.stats") ?? [];
  const values = tv<ValueItem[]>("about.values") ?? [];

  return (
    <SiteLayout>
      <PageHeader
        eyebrow={t("about.eyebrow")}
        title={t("about.pageTitle")}
        subtitle={t("about.pageSubtitle")}
        image={headerImage}
      />

      {/* Stats strip */}
      <section className="relative overflow-hidden bg-navy py-14 sm:py-16 lg:py-20">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(200,169,106,0.14),transparent_55%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/40 to-transparent"
        />
        <div className="container-luxe relative grid gap-10 sm:grid-cols-3 sm:gap-6 lg:gap-10">
          {stats.map((stat, index) => (
            <Reveal
              key={stat.label}
              delay={index * 0.1}
              className="group relative text-center sm:px-4"
            >
              <p className="text-[0.6rem] tracking-[0.28em] text-gold/70 uppercase">0{index + 1}</p>
              <p className="mt-3 font-display text-5xl leading-none text-gold sm:text-6xl lg:text-7xl">
                <Counter value={stat.value} suffix={stat.suffix} />
              </p>
              <span
                aria-hidden
                className="mx-auto mt-5 block h-px w-12 bg-gold/45 transition-all duration-500 group-hover:w-20 group-hover:bg-gold"
              />
              <p className="mx-auto mt-5 max-w-[15rem] text-sm leading-relaxed text-navy-foreground/65 sm:max-w-[17rem]">
                {stat.label}
              </p>
              {index < stats.length - 1 ? (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-y-2 end-0 hidden w-px bg-gradient-to-b from-transparent via-navy-foreground/15 to-transparent sm:block"
                />
              ) : null}
            </Reveal>
          ))}
        </div>
      </section>

      {/* Story — asymmetric */}
      <section className="bg-background py-16 sm:py-20 lg:py-24">
        <div className="container-luxe grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14 xl:gap-20">
          <Reveal direction="left" className="relative">
            <img
              src={aboutImage}
              alt=""
              loading="lazy"
              width={1600}
              height={1200}
              className="aspect-[4/3] w-full object-cover object-[center_42%]"
            />
            <div className="absolute bottom-0 inset-inline-start-0 border border-gold/40 bg-navy px-7 py-6 text-white sm:inset-inline-start-6 sm:bottom-6">
              <p className="text-[0.65rem] tracking-[0.22em] text-gold uppercase">
                {t("about.since.label")}
              </p>
              <p className="mt-1 font-display text-4xl">{t("about.since.year")}</p>
              <p className="mt-1 text-xs text-white/60">{t("about.since.caption")}</p>
            </div>
          </Reveal>

          <Reveal direction="right">
            <p className="eyebrow">{t("about.story.eyebrow")}</p>
            <h2 className="type-display-m mt-3 text-navy sm:mt-4">{t("about.story.title")}</h2>
            <span className="gold-rule mt-5 sm:mt-6" />
            <p className="type-body mt-6 text-navy/75 sm:mt-7">{t("about.story.body")}</p>
          </Reveal>
        </div>
      </section>

      {/* Mission / Vision */}
      <section className="bg-sand py-16 sm:py-20 lg:py-24">
        <div className="container-luxe grid gap-10 lg:grid-cols-2 lg:gap-14">
          <Reveal className="border-s-2 border-gold ps-7 sm:ps-10">
            <p className="eyebrow">{t("about.mission.eyebrow")}</p>
            <p className="type-display-s mt-4 text-navy sm:mt-5 sm:text-2xl lg:text-3xl">
              {t("about.mission.body")}
            </p>
          </Reveal>
          <Reveal delay={0.1} className="border-s-2 border-navy/25 ps-7 sm:ps-10">
            <p className="eyebrow">{t("about.vision.eyebrow")}</p>
            <p className="type-display-s mt-4 text-navy sm:mt-5 sm:text-2xl lg:text-3xl">
              {t("about.vision.body")}
            </p>
          </Reveal>
        </div>
      </section>

      {/* Values */}
      <section className="bg-background py-16 sm:py-20 lg:py-24">
        <div className="container-luxe">
          <Reveal className="max-w-2xl">
            <p className="eyebrow">{t("about.eyebrow")}</p>
            <h2 className="type-display-m mt-3 text-navy sm:mt-4">{t("about.valuesTitle")}</h2>
            <p className="type-body mt-4 text-muted-foreground sm:mt-5">{t("about.valuesLead")}</p>
          </Reveal>

          <div className="mt-12 grid gap-x-10 gap-y-10 sm:mt-14 sm:grid-cols-2 sm:gap-y-12 lg:gap-x-14">
            {values.map((value, index) => (
              <Reveal key={value.title} delay={index * 0.06} className="flex gap-4">
                <span className="mt-1 text-lg text-gold" aria-hidden>
                  ✦
                </span>
                <div>
                  <h3 className="type-display-s text-navy">{value.title}</h3>
                  <p className="type-body-sm mt-3 max-w-md text-muted-foreground">
                    {value.description}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Clients */}
      <section className="relative overflow-hidden bg-[#050d18] py-16 sm:py-20 lg:py-24">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(200,169,106,0.12),transparent_55%)]"
        />
        <div className="container-luxe relative max-w-3xl text-center text-white">
          <Reveal>
            <p className="eyebrow">{t("about.clients.eyebrow")}</p>
            <h2 className="type-display-m mt-3 sm:mt-4">{t("about.clients.title")}</h2>
            <p className="type-body mt-5 text-white/65 sm:mt-6">{t("about.clients.body")}</p>
            <p className="type-display-s mt-10 text-gold sm:mt-12 sm:text-2xl lg:text-3xl">
              “{t("about.clients.quote")}”
            </p>
          </Reveal>
        </div>
      </section>

      <FleetSection />
      <WhyChooseUs />

      {/* CTA */}
      <section className="relative overflow-hidden border-t border-border bg-sand py-16 sm:py-20 lg:py-24">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,rgba(200,169,106,0.12),transparent_50%)]"
        />
        <div className="container-luxe relative flex flex-col items-start justify-between gap-8 lg:flex-row lg:items-end lg:gap-12">
          <Reveal>
            <p className="eyebrow">{t("about.ctaBand.eyebrow")}</p>
            <h2 className="type-display-m mt-3 max-w-xl text-navy sm:mt-4">
              {t("about.ctaBand.title")}
            </h2>
            <p className="type-body mt-4 max-w-lg text-muted-foreground sm:mt-5">
              {t("about.ctaBand.body")}
            </p>
          </Reveal>
          <Reveal delay={0.1}>
            <Link
              to="/contact"
              className="type-cta inline-flex shrink-0 items-center gap-3 border border-navy bg-navy px-7 py-3.5 text-navy-foreground transition-all duration-500 hover:border-gold hover:bg-gold hover:text-navy sm:px-8 sm:py-4"
            >
              {t("about.ctaBand.button")}
              <span aria-hidden>➝</span>
            </Link>
          </Reveal>
        </div>
      </section>
    </SiteLayout>
  );
}
