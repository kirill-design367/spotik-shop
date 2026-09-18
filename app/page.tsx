import Hero from '@/components/sections/Hero';
import Pricing from '@/components/sections/Pricing';
import HowItWorks from '@/components/sections/HowItWorks';
import Benefits from '@/components/sections/Benefits';
import Gift from '@/components/sections/Gift';
import Faq from '@/components/sections/Faq';
import Footer from '@/components/sections/Footer';
import RevealRoot from '@/components/chrome/RevealRoot';

export default function Page() {
  return (
    <>
      <main id="main" tabIndex={-1}>
        <Hero />
        <Pricing />
        <HowItWorks />
        <Benefits />
        <Gift />
        <Faq />
      </main>
      <Footer />
      {/* Один наблюдатель на всю страницу: появление строк в кадре. */}
      <RevealRoot />
    </>
  );
}
