'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/landing/Navbar';
import { HeroSection } from '@/components/landing/HeroSection';
import { TrustSection } from '@/components/landing/TrustSection';
import { ProductPreviewSection } from '@/components/landing/ProductPreviewSection';
import { ProblemSection } from '@/components/landing/ProblemSection';
import { FeaturesSection } from '@/components/landing/FeaturesSection';
import { HowItWorksSection } from '@/components/landing/HowItWorksSection';
import { AIOutreachSection } from '@/components/landing/AIOutreachSection';
import { WebsiteDemoSection } from '@/components/landing/WebsiteDemoSection';
import { FinalCTASection } from '@/components/landing/FinalCTASection';
import { Footer } from '@/components/landing/Footer';
import { DemoModal } from '@/components/landing/DemoModal';
import { LayoutDashboard, Home } from 'lucide-react';

export default function CombinedApp() {
  const router = useRouter();
  const [isDemoModalOpen, setIsDemoModalOpen] = useState(false);
  const [selectedDemoBusiness, setSelectedDemoBusiness] = useState('Saffron & Spice Bistro');

  // Listen for query params on load or popstate
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const view = params.get('view');

      if (view === 'dashboard' || view === 'auth' || view === 'login' || view === 'signup') {
        router.push('/dashboard');
      }
    }
  }, [router]);

  const handleNavigate = (view: 'landing' | 'dashboard' | 'auth', mode?: 'signin' | 'signup') => {
    if (view === 'dashboard' || view === 'auth') {
      router.push('/dashboard');
      return;
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleOpenDemo = (businessName: string) => {
    setSelectedDemoBusiness(businessName);
    setIsDemoModalOpen(true);
  };

  return (
    <div className="relative min-h-screen bg-white">
      {/* ========================================================================= */}
      {/* 🚀 FLOATING UNIFIED SWITCHER BAR (Always available for 1-click toggling)  */}
      {/* ========================================================================= */}
      <aside 
        aria-label="Application View Switcher" 
        className="fixed bottom-4 sm:bottom-6 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-1 sm:gap-2 p-1.5 rounded-full bg-slate-950/90 hover:bg-slate-950 text-white backdrop-blur-xl shadow-[0_12px_36px_rgba(0,0,0,0.35)] border border-slate-700/80 transition-all select-none animate-fade-in"
      >
        <button
          onClick={() => handleNavigate('landing')}
          className={`flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-full text-xs font-semibold transition-all cursor-pointer bg-white text-slate-950 shadow-md scale-100`}
        >
          <Home className="w-3.5 h-3.5" />
          <span>Landing Page</span>
        </button>

        <button
          onClick={() => handleNavigate('dashboard')}
          className="flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-full text-xs font-semibold transition-all cursor-pointer text-slate-300 hover:text-white hover:bg-slate-800/60"
        >
          <LayoutDashboard className="w-3.5 h-3.5 text-teal-400" />
          <span>Dashboard</span>
        </button>
      </aside>

      {/* ========================================================================= */}
      {/* 1. LANDING PAGE VIEW (Default)                                            */}
      {/* ========================================================================= */}
      <div className="min-h-screen bg-white text-slate-900 selection:bg-teal-50 selection:text-teal-900">
        {/* 1. Floating Top Navigation */}
        <Navbar onNavigate={handleNavigate} />

          {/* 2. Main Page Content */}
          <main>
            {/* Hero Section with Interactive 5-Step Workflow Visualizer */}
            <HeroSection />

            {/* Category Trust Bar */}
            <TrustSection />

            {/* Interactive Product Preview (Search: Industry, Location, Leads & Opportunities) */}
            <ProductPreviewSection onPreviewDemo={handleOpenDemo} />

            {/* Problem Section: 01 No Website, 02 Weak Website, 03 Missed Opportunity */}
            <ProblemSection />

            {/* Core Product Capabilities (5 Focused Features) */}
            <FeaturesSection />

            {/* How It Works: 4 Clean Steps */}
            <HowItWorksSection />

            {/* AI Outreach: Contextual Outreach Generation */}
            <AIOutreachSection />

            {/* Website Demo Section: Interactive Client Prototypes */}
            <WebsiteDemoSection onPreviewDemo={handleOpenDemo} />

            {/* Final Conversion CTA Section */}
            <FinalCTASection />
          </main>

          {/* 3. Minimal Footer */}
          <Footer />

        <DemoModal
          isOpen={isDemoModalOpen}
          businessName={selectedDemoBusiness}
          onClose={() => setIsDemoModalOpen(false)}
        />
      </div>
    </div>
  );
}
