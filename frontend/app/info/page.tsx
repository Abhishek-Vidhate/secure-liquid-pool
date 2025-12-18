"use client";

import Link from "next/link";
import LightPillar from "@/src/components/LightPillar";

export default function InfoPage() {
  return (
    <div className="relative min-h-screen bg-black text-white overflow-hidden selection:bg-cyan-500/30">

      {/* Light Pillar Background */}
      {/* Light Pillar Background - Fixed */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 w-full h-full">
          <LightPillar
            topColor="#5227FF"
            bottomColor="#FF9FFC"
            intensity={1.0}
            rotationSpeed={0.5}
            glowAmount={0.005}
            pillarWidth={3.0}
            pillarHeight={0.4}
            noiseIntensity={0.5}
            pillarRotation={0}
            interactive={false}
            mixBlendMode="normal"
          />
        </div>
        {/* Gradient Overlay for content readability */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-black/40 to-black"></div>
      </div>

      <div className="relative z-10 container mx-auto px-6 py-24 md:py-32 max-w-7xl">
        {/* Navigation */}
        <nav className="fixed top-8 left-4 md:left-8 z-50">
          <Link href="/" className="text-zinc-200 hover:text-white transition-colors flex items-center gap-2 text-sm font-medium backdrop-blur-md bg-zinc-900/60 hover:bg-zinc-800/80 p-3 rounded-full border border-white/10 shadow-lg group">
            <svg className="group-hover:-translate-x-1 transition-transform" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
            Back to App
          </Link>
        </nav>

        {/* Hero Section */}
        <section className="mb-48 text-center pt-20 animate-fade-in-up">
          <h1 className="text-6xl md:text-8xl font-bold tracking-tighter bg-clip-text text-transparent bg-gradient-to-b from-white to-white/70 mb-10 drop-shadow-2xl">
            Protected. Liquid. Secure.
          </h1>
          <p className="text-2xl md:text-3xl text-zinc-200 max-w-3xl mx-auto font-light leading-relaxed delay-100 drop-shadow-md">
            Understanding how SecureLiquidPool shields your assets from predatory MEV bots on Solana.
          </p>
        </section>

        {/* Sandwich Attack Section */}
        <section className="mb-48 grid lg:grid-cols-2 gap-20 items-center">
          <div className="space-y-8">
            <h2 className="text-4xl md:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-red-400 to-orange-400 flex items-center gap-4">
              <span className="text-4xl">🥪</span>
              What is a Sandwich Attack?
            </h2>
            <div className="prose prose-xl prose-invert text-zinc-100 leading-relaxed">
              <p>
                Imagine this scenario: You find a promising coin on Solana. The market cap is still low ($50K) with high growth potential. You decide to pull the trigger and swap your SOL for the token.
              </p>
              <div className="border-l-4 border-red-500/50 pl-6 italic bg-gradient-to-r from-red-500/10 to-transparent py-6 my-8 rounded-r-xl">
                However, as you do this, something unexpected happens — the market cap suddenly jumps to $200K as your transaction is executed, then immediately drops back to around $50K.
              </div>
              <p>
                You took an instant 75% loss on the token. <strong className="text-red-400">What happened?</strong> Well, you’ve just been sandwiched. Bots detected your pending transaction, jumped in before you to buy (raising the price), let your buy go through (at the inflated price), and then immediately sold their tokens for a risk-free profit at your expense.
              </p>
            </div>
          </div>

          {/* Image Visualization: Sandwich Attack */}
          <div className="relative aspect-video rounded-3xl border border-zinc-700/50 bg-black/40 backdrop-blur-sm overflow-hidden shadow-2xl shadow-red-900/20 hover:scale-[1.01] transition-transform duration-500">
            <img
              src="/sandwich-attack-bg.png"
              alt="Sandwich Attack Visualization"
              className="w-full h-full object-contain p-4"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none"></div>
            <p className="absolute bottom-6 left-6 text-[10px] uppercase tracking-wider text-zinc-400 font-mono bg-black/80 px-2 py-1 rounded border border-zinc-800">
              Figure 1: Price Manipulation Mechanics
            </p>
          </div>
        </section>

        {/* How App Works Section */}
        <section className="mb-32 grid lg:grid-cols-2 gap-20 items-center">
          {/* YouTube Video: Protection Demo */}
          <div className="order-2 lg:order-1 aspect-video bg-black/40 backdrop-blur-sm rounded-3xl border border-zinc-700/50 flex items-center justify-center relative group overflow-hidden shadow-2xl shadow-emerald-900/20 hover:scale-[1.01] transition-transform duration-500">
            <iframe
              width="100%"
              height="100%"
              src="https://www.youtube.com/embed/q_Cmnj-2DFQ?autoplay=1&mute=1&controls=0&loop=1&playlist=q_Cmnj-2DFQ&rel=0&modestbranding=1&playsinline=1&vq=hd2160"
              title="SecureLiquidPool Protection Demo"
              frameBorder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              className="absolute inset-0 w-full h-full rounded-3xl"
            ></iframe>
          </div>

          <div className="order-1 lg:order-2 space-y-10">
            <h2 className="text-4xl md:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-l from-emerald-400 to-cyan-400 flex items-center gap-4">
              <span className="text-4xl">🔒</span>
              How We Protect You
            </h2>
            <div className="space-y-8">
              <FeatureStep
                number="01"
                title="Commit & Hide"
                desc="We use a commit-reveal scheme. Instead of broadcasting your trade publicly, we first commit a hashed version of your intent. Bots see a transaction, but they can't see what you're buying or for how much."
              />
              <FeatureStep
                number="02"
                title="Secure Delay"
                desc="A minimal on-chain delay ensures your commitment is locked in before the details are revealed. This prevents bots from reacting instantaneously to your trade parameters."
              />
              <FeatureStep
                number="03"
                title="Atomic Execution"
                desc="We use Jito bundles to execute your swap and stake in a single, atomic bundle that bypasses the public mempool purely for execution. Your transaction lands securely without being front-run."
              />
            </div>
          </div>
        </section>

        {/* Proof of Effectiveness Section */}
        <section className="mb-32">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-8">
              Verifiable Proof: <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-fuchsia-400">Simulation Results</span>
            </h2>
            <p className="text-zinc-200 text-xl max-w-4xl mx-auto leading-relaxed drop-shadow-sm">
              We verify our protection by running a <strong className="text-white">live localnet simulation</strong>.
              We deploy real Solana validators and sandwich attack bots that aggressively monitor the mempool.
              While normal traders get attacked and lose funds, our protected traders using the SecureLiquidPool program
              successfully evade all attacks, saving 100% of the potential lost value.
            </p>
          </div>

          <div className="grid lg:grid-cols-5 gap-10 bg-zinc-900/60 border border-zinc-700/50 rounded-[2rem] p-8 md:p-10 backdrop-blur-md shadow-2xl">

            {/* Simulation Video */}
            <div className="lg:col-span-3 space-y-6">
              <div className="aspect-video bg-black rounded-2xl border border-zinc-800 overflow-hidden shadow-2xl">
                <iframe
                  width="100%"
                  height="100%"
                  src="https://www.youtube.com/embed/hdQ_TeeHmb8?si=fAvl3s2A4NknllK8&rel=0&modestbranding=1"
                  title="MEV Simulation Proof"
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  className="w-full h-full"
                ></iframe>
              </div>

              {/* Tip Box */}
              <div className="bg-blue-500/10 border border-blue-400/30 rounded-xl p-4 flex items-start gap-4 text-base text-blue-100">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400 flex-shrink-0 mt-0.5"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
                <span>
                  <strong>Pro Tip:</strong> Watch at <strong>2x or 3x speed</strong> and <strong>4K resolution</strong> to see the logs clearly.
                </span>
              </div>
            </div>

            {/* Key Metrics / Explanation */}
            <div className="lg:col-span-2 flex flex-col justify-center space-y-8">
              <h3 className="text-2xl font-bold text-white">What you're watching:</h3>
              <ul className="space-y-6">
                <li className="flex gap-4">
                  <div className="w-8 h-8 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center text-sm font-bold border border-red-500/30 flex-shrink-0">1</div>
                  <p className="text-base text-zinc-300 leading-relaxed"><strong className="text-white text-lg">Normal Trader:</strong> Sends a standard swap. The bot immediately sees it, sandwiches it, and the trader loses SOL.</p>
                </li>
                <li className="flex gap-4">
                  <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-sm font-bold border border-emerald-500/30 flex-shrink-0">2</div>
                  <p className="text-base text-zinc-300 leading-relaxed"><strong className="text-white text-lg">Protected Trader:</strong> Sends a commit hash. The bot sees nothing useful. The reveal executes atomically, and the trader keeps all their SOL.</p>
                </li>
                <li className="flex gap-4">
                  <div className="w-8 h-8 rounded-full bg-violet-500/20 text-violet-400 flex items-center justify-center text-sm font-bold border border-violet-500/30 flex-shrink-0">3</div>
                  <p className="text-base text-zinc-300 leading-relaxed"><strong className="text-white text-lg">Verification:</strong> The simulation logs confirm 0% attack success rate against our protocol.</p>
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-zinc-800/50 pt-20 pb-10 flex flex-col items-center justify-center gap-10">
          <div className="text-center space-y-3">
            <h3 className="text-white font-bold text-xl">SecureLiquidPool</h3>
            <p className="text-zinc-400 text-base">Open source, verifiable, and secure.</p>
          </div>

          <a
            href="https://github.com/Abhishek-Vidhate/secure-liquid-pool"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-4 px-10 py-5 bg-zinc-900/80 hover:bg-zinc-800 rounded-full transition-all border border-zinc-700 hover:border-zinc-500 shadow-xl hover:shadow-2xl hover:scale-105"
          >
            <svg height="24" width="24" viewBox="0 0 16 16" fill="currentColor" className="text-white group-hover:text-white transition-colors">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path>
            </svg>
            <span className="font-bold text-lg text-white">View Source on GitHub</span>
          </a>
        </footer>
      </div>
    </div>
  );
}

function FeatureStep({ number, title, desc }: { number: string; title: string; desc: string }) {
  return (
    <div className="flex gap-6 p-4 rounded-xl hover:bg-white/5 transition-colors border border-transparent hover:border-white/5">
      <div className="flex-shrink-0 w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 text-emerald-400 flex items-center justify-center font-bold border border-white/10 text-lg">
        {number}
      </div>
      <div>
        <h3 className="font-semibold text-white text-lg mb-2">{title}</h3>
        <p className="text-zinc-400 text-base leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}
