import { CategoryMarquee } from "@/components/marketing/category-marquee";
import { EngineExplorer } from "@/components/marketing/engine-explorer";
import { FinalCta } from "@/components/marketing/final-cta";
import { Hero } from "@/components/marketing/hero";
import { LoopShowcase } from "@/components/marketing/loop-showcase";
import { Pillars } from "@/components/marketing/pillars";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";

export default function HomePage() {
  return (
    <div id="top" className="bg-canvas">
      <SiteHeader />
      <main>
        <Hero />
        <CategoryMarquee />
        <Pillars />
        <LoopShowcase />
        <EngineExplorer />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}
