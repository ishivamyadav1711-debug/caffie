'use client';

import React, { useState } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { SocialLeadsView } from '@/components/views/SocialLeadsView';
import { ToastContainer } from '@/components/common/Toast';
import { ToastMessage, NavTab } from '@/types';
import { useRouter } from 'next/navigation';

export default function SocialLeadsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<NavTab>('social-leads');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const handleNavigateTab = (tab: NavTab) => {
    if (tab === 'social-leads') return;
    if (tab === 'enrich') {
      router.push('/dashboard/enrich');
    } else {
      router.push('/dashboard');
    }
  };

  const addToast = (
    title: string,
    description?: string,
    type: 'success' | 'info' | 'warning' | 'error' = 'info'
  ) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, title, description, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <div className="flex min-h-screen bg-[#F8F9FA] text-[#0F172A] font-sans antialiased">
      {/* 1. Left Sidebar */}
      <Sidebar
        activeTab="social-leads"
        setActiveTab={handleNavigateTab}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 2. Top Header */}
        <Header
          activeTab="social-leads"
          onOpenCommandPalette={() => {}}
          onShowToast={addToast}
          onNavigateTab={handleNavigateTab}
        />

        {/* 3. Social Leads Page Content */}
        <main className="flex-1 p-6 overflow-y-auto max-w-[1400px] w-full mx-auto space-y-6">
          <SocialLeadsView />
        </main>
      </div>

      {/* Toast Notification Container */}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </div>
  );
}
