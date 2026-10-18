'use client';

import React, { useState } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { EnrichContactForm } from '@/components/enrichment/EnrichContactForm';
import { ToastContainer } from '@/components/common/Toast';
import { ToastMessage, NavTab } from '@/types';
import { useRouter } from 'next/navigation';

export default function EnrichPage() {
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = (
    title: string,
    description?: string,
    type: 'success' | 'info' | 'warning' | 'error' = 'success'
  ) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    const newToast: ToastMessage = { id, title, description, type };
    setToasts((prev) => [...prev, newToast]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const handleNavigateTab = (tab: NavTab) => {
    if (tab === 'enrich') return;
    router.push('/dashboard');
  };

  return (
    <div className="flex h-screen bg-[#F8FAFC] text-[#0F172A] overflow-hidden font-sans">
      {/* 1. Left Sidebar with Enrich Contact highlighted */}
      <Sidebar
        activeTab="enrich"
        setActiveTab={handleNavigateTab}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
      />

      {/* 2. Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Header */}
        <Header
          activeTab="enrich"
          onOpenCommandPalette={() => {}}
          onShowToast={addToast}
          onNavigateTab={handleNavigateTab}
        />

        {/* Page Content Container */}
        <main className="flex-1 p-6 overflow-y-auto max-w-[1400px] w-full mx-auto space-y-6">
          {/* Page Heading */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-5 rounded-2xl border border-[#E2E8F0] shadow-2xs">
            <div>
              <h1 className="text-[18px] font-bold text-[#0F172A] tracking-tight">
                Contact Enrichment Engine
              </h1>
              <p className="text-[12.5px] text-[#64748B] mt-0.5">
                Multi-provider waterfall enrichment for verified work emails, personal emails, and direct phone numbers.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                Live Backend API Connected
              </span>
            </div>
          </div>

          {/* Form and Result Component */}
          <EnrichContactForm />
        </main>
      </div>

      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </div>
  );
}
