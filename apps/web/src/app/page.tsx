import { CategoryMarquee } from "@/components/marketing/category-marquee";
import { EngineExplorer } from "@/components/marketing/engine-explorer";
import { FinalCta } from "@/components/marketing/final-cta";
import { Hero } from "@/components/marketing/hero";
import { LandingCursor } from "@/components/marketing/landing-cursor";
import { Pillars } from "@/components/marketing/pillars";
import { Pricing } from "@/components/marketing/pricing";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
export default function HomePage() {
  return (
    <div id="top" className="bg-canvas">
      <LandingCursor />
      <SiteHeader />
      <main>
        <Hero />
        <CategoryMarquee />
        <Pillars />
        <EngineExplorer />
        <Pricing />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}
