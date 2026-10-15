'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowRight, Menu, X, Compass, Sparkles } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';

interface NavbarProps {
  onNavigate?: (view: 'landing' | 'dashboard' | 'auth', authMode?: 'signin' | 'signup') => void;
}

export function Navbar({ onNavigate }: NavbarProps = {}) {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 transition-all duration-300 px-4 sm:px-6 pt-3 sm:pt-4">
      <div
        className={`max-w-6xl mx-auto transition-all duration-300 rounded-full px-4 sm:px-6 py-2.5 sm:py-3 flex items-center justify-between ${
          isScrolled
            ? 'bg-white/90 backdrop-blur-md shadow-[0_4px_24px_-4px_rgba(0,0,0,0.06)] border border-slate-200/80'
            : 'bg-white/80 backdrop-blur-sm border border-slate-200/60 shadow-[0_2px_12px_-2px_rgba(0,0,0,0.03)]'
        }`}
      >
        {/* Left: Brand + AI Badge */}
        <div
          onClick={() => onNavigate?.('landing')}
          className="flex items-center gap-2.5 group cursor-pointer select-none"
        >
          <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center text-white shadow-sm group-hover:bg-slate-800 transition-colors">
            {/* Custom geometric pilot/compass glyph */}
            <div className="relative w-4 h-4 flex items-center justify-center">
              <span className="w-2.5 h-2.5 rounded-full border-2 border-teal-400 block" />
              <span className="absolute w-1 h-3.5 bg-white rounded-full transform rotate-45" />
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[17px] font-bold tracking-[-0.02em] text-slate-900 group-hover:text-black transition-colors">
              LeadPilot
            </span>
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold tracking-wide bg-teal-50 text-teal-700 border border-teal-200/70">
              <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse" />
              AI
            </span>
          </div>
        </div>

        {/* Center: Navigation Links */}
        <nav className="hidden md:flex items-center gap-1 lg:gap-2">
          <a
            href="#product"
            className="text-[13px] font-medium text-slate-600 hover:text-slate-950 px-3 py-1.5 rounded-full hover:bg-slate-100/70 transition-colors"
          >
            Product
          </a>
          <a
            href="#solutions"
            className="text-[13px] font-medium text-slate-600 hover:text-slate-950 px-3 py-1.5 rounded-full hover:bg-slate-100/70 transition-colors"
          >
            Solutions
          </a>
          <a
            href="#how-it-works"
            className="text-[13px] font-medium text-slate-600 hover:text-slate-950 px-3 py-1.5 rounded-full hover:bg-slate-100/70 transition-colors"
          >
            How It Works
          </a>
          <a
            href="#ai-outreach"
            className="text-[13px] font-medium text-slate-600 hover:text-slate-950 px-3 py-1.5 rounded-full hover:bg-slate-100/70 transition-colors"
          >
            AI Outreach
          </a>
          <a
            href="#website-demos"
            className="text-[13px] font-medium text-slate-600 hover:text-slate-950 px-3 py-1.5 rounded-full hover:bg-slate-100/70 transition-colors"
          >
            Website Demos
          </a>
        </nav>

        {/* Right: Actions */}
        <div className="hidden sm:flex items-center gap-2 sm:gap-3">
          <ThemeToggle />
          <button
            onClick={() => onNavigate ? onNavigate('dashboard') : (window.location.href = '/dashboard')}
            className="text-[13px] font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100/80 border border-teal-200/70 px-3.5 py-1.5 rounded-full transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs hover:scale-[1.02] active:scale-[0.98]"
          >
            <Sparkles className="w-3.5 h-3.5 text-teal-600" />
            <span>Dashboard</span>
          </button>

          {onNavigate ? (
            <button
              onClick={() => onNavigate('dashboard')}
              className="text-[13px] font-medium text-slate-600 hover:text-slate-900 px-3 py-1.5 transition-colors cursor-pointer"
            >
              Sign In
            </button>
          ) : (
            <Link
              href="/dashboard"
              className="text-[13px] font-medium text-slate-600 hover:text-slate-900 px-3 py-1.5 transition-colors"
            >
              Sign In
            </Link>
          )}

          {onNavigate ? (
            <button
              onClick={() => onNavigate('dashboard')}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-medium text-white bg-slate-900 hover:bg-slate-800 transition-all duration-200 shadow-sm hover:shadow hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
            >
              <span>Get Started</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-medium text-white bg-slate-900 hover:bg-slate-800 transition-all duration-200 shadow-sm hover:shadow hover:scale-[1.02] active:scale-[0.98]"
            >
              <span>Get Started</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          )}
        </div>

        {/* Mobile menu button */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="md:hidden p-1.5 text-slate-600 hover:text-slate-900 focus:outline-none"
          aria-label="Toggle Menu"
        >
          {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile dropdown */}
      {mobileMenuOpen && (
        <div className="md:hidden max-w-6xl mx-auto mt-2 p-4 bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200 shadow-lg animate-fade-in flex flex-col gap-2">
          <a
            href="#product"
            onClick={() => setMobileMenuOpen(false)}
            className="px-3 py-2 text-sm font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-50 rounded-lg"
          >
            Product
          </a>
          <a
            href="#solutions"
            onClick={() => setMobileMenuOpen(false)}
            className="px-3 py-2 text-sm font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-50 rounded-lg"
          >
            Solutions
          </a>
          <a
            href="#how-it-works"
            onClick={() => setMobileMenuOpen(false)}
            className="px-3 py-2 text-sm font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-50 rounded-lg"
          >
            How It Works
          </a>
          <a
            href="#ai-outreach"
            onClick={() => setMobileMenuOpen(false)}
            className="px-3 py-2 text-sm font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-50 rounded-lg"
          >
            AI Outreach
          </a>
          <a
            href="#website-demos"
            onClick={() => setMobileMenuOpen(false)}
            className="px-3 py-2 text-sm font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-50 rounded-lg"
          >
            Website Demos
          </a>

          <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <Link
                href="/dashboard"
                className="text-xs font-medium text-slate-600 px-3 py-2"
              >
                Sign In
              </Link>
            </div>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-medium text-white bg-slate-900"
            >
              <span>Get Started</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
