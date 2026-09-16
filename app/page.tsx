import Hero from '@/components/sections/Hero';
import Pricing from '@/components/sections/Pricing';
import HowItWorks from '@/components/sections/HowItWorks';
import Benefits from '@/components/sections/Benefits';
import Gift from '@/components/sections/Gift';
import Faq from '@/components/sections/Faq';
import Footer from '@/components/sections/Footer';
import Playhead from '@/components/chrome/Playhead';

export default function Page() {
  return (
    <>
      <Playhead />
      <main id="main" tabIndex={-1}>
        <Hero />
        <Pricing />
        <HowItWorks />
        <Benefits />
        <Gift />
        <Faq />
      </main>
      <Footer />
    </>
  );
}
