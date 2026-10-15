'use client';

import React, { useState, useRef, useEffect } from 'react';
import { 
  Search, 
  Bell, 
  Command, 
  User, 
  LogOut, 
  ShieldCheck, 
  Settings
} from 'lucide-react';
import { NavTab } from '@/types';

interface HeaderProps {
  activeTab: NavTab;
  onOpenCommandPalette: () => void;
  onShowToast: (title: string, desc?: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
  onNavigateTab?: (tab: NavTab) => void;
}

const tabTitles: Record<NavTab, { title: string; subtitle: string }> = {
  overview: {
    title: 'Good evening, Alex',
    subtitle: 'Find and manage businesses that need a better website.',
  },
  'find-leads': {
    title: 'Find Leads',
    subtitle: 'Discover high-intent businesses across industries and locations.',
  },
  leads: {
    title: 'All Leads',
    subtitle: 'Manage your qualified pipeline, status, and outreach readiness.',
  },
  'website-audit': {
    title: 'Website Audit',
    subtitle: 'Analyze performance, mobile responsiveness, and conversion gaps.',
  },
  'ai-messages': {
    title: 'AI Outreach',
    subtitle: 'Personalized cold email and LinkedIn message generation.',
  },
  'demo-websites': {
    title: 'Website Demos',
    subtitle: 'Generate and share interactive 1-click client demo websites.',
  },
  campaigns: {
    title: 'Campaigns',
    subtitle: 'Track outreach sequences and client conversions.',
  },
  'outreach-history': {
    title: 'Outreach Tracking & Audit',
    subtitle: 'Review dispatched emails, sender mailbox provenance, and Gmail replies.',
  },
  senders: {
    title: 'Company Sender Mailboxes',
    subtitle: 'Manage authorized Google Workspace mailboxes, DNS readiness, and safety limits.',
  },
  settings: {
    title: 'Settings',
    subtitle: 'Manage workspace configuration, scraping rules, and integrations.',
  },
  help: {
    title: 'Help & Docs',
    subtitle: 'Guides and resources for getting the most from LeadPilot.',
  },
};

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onOpenCommandPalette,
  onShowToast,
  onNavigateTab,
}) => {
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState([
    {
      id: 'notif-1',
      title: 'Database Persistence Active',
      description: 'Connected to canonical SQLite Prisma database.',
      message: 'Connected to canonical SQLite Prisma database.',
      time: 'Real-time',
      read: false,
    },
  ]);
  const notifRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setNotificationsOpen(false);
      }
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const markAllAsRead = () => {
    setNotifications(notifications.map((n) => ({ ...n, read: true })));
    onShowToast('Notifications Cleared', 'All alerts have been marked as read.', 'info');
  };

  const currentHeaderInfo = tabTitles[activeTab] || tabTitles.overview;

  return (
    <header className="sticky top-0 z-20 flex h-16 w-full items-center justify-between border-b border-[#E5E7EB] bg-white px-6 select-none">
      {/* Left: Page title & Small Subtitle */}
      <div className="flex flex-col justify-center min-w-0">
        <h1 className="text-[16px] font-semibold text-[#0F172A] tracking-tight leading-snug truncate">
          {currentHeaderInfo.title}
        </h1>
        <p className="text-[12px] text-[#64748B] leading-none mt-0.5 truncate">
          {currentHeaderInfo.subtitle}
        </p>
      </div>

      {/* Right: Search, Notifications, User profile */}
      <div className="flex items-center gap-3">
        {/* Search */}
        <button
          onClick={onOpenCommandPalette}
          className="flex items-center gap-2 h-9 min-h-[36px] rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3.5 py-1.5 text-[12.5px] text-[#64748B] hover:border-[#CBD5E1] hover:bg-white hover:text-[#0F172A] transition-all shadow-2xs group btn-pressable cursor-pointer"
          title="Search dashboard (Ctrl+K)"
        >
          <Search className="h-3.5 w-3.5 text-[#94A3B8] group-hover:text-[#0F172A] transition-colors" />
          <span className="hidden sm:inline">Search...</span>
          <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-[#E2E8F0] bg-white px-1.5 py-0.5 text-[10px] font-medium text-[#64748B]">
            <Command className="h-2.5 w-2.5" /> K
          </kbd>
        </button>

        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => setNotificationsOpen(!notificationsOpen)}
            className="relative flex h-9 w-9 min-h-[36px] min-w-[36px] items-center justify-center rounded-xl border border-[#E2E8F0] bg-white text-[#64748B] hover:bg-[#F8FAFC] hover:text-[#0F172A] transition-colors btn-pressable cursor-pointer shadow-2xs"
            title="Notifications"
          >
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-teal-600 px-1 text-[9px] font-bold text-white ring-2 ring-white">
                {unreadCount}
              </span>
            )}
          </button>

          {/* Notifications Dropdown Panel */}
          {notificationsOpen && (
            <div className="absolute right-0 mt-2 w-80 rounded-2xl border border-[#E2E8F0] bg-white shadow-xl py-2 z-50 animate-popover">
              <div className="flex items-center justify-between px-3.5 pb-2 border-b border-[#F1F5F9]">
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px] font-semibold text-[#0F172A]">Notifications</span>
                  {unreadCount > 0 && (
                    <span className="rounded-md bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700 border border-teal-200">
                      {unreadCount} new
                    </span>
                  )}
                </div>
                {unreadCount > 0 && (
                  <button
                    onClick={markAllAsRead}
                    className="text-[11px] text-teal-700 hover:underline font-medium cursor-pointer"
                  >
                    Mark all read
                  </button>
                )}
              </div>

              <div className="max-h-72 overflow-y-auto divide-y divide-[#F1F5F9]">
                {notifications.length === 0 ? (
                  <div className="py-6 text-center text-[12px] text-[#94A3B8]">
                    No notifications right now
                  </div>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      className={`px-3.5 py-2.5 text-[12px] hover:bg-[#F8FAFC] transition-colors cursor-pointer ${
                        !n.read ? 'bg-teal-50/30' : ''
                      }`}
                      onClick={() => {
                        setNotifications(notifications.map(item => item.id === n.id ? { ...item, read: true } : item));
                        onShowToast(n.title, n.message, 'info');
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium text-[#0F172A]">{n.title}</span>
                        <span className="text-[10.5px] text-[#94A3B8] shrink-0">{n.time}</span>
                      </div>
                      <p className="text-[#64748B] text-[11.5px] mt-0.5 leading-snug">{n.message}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* User Profile */}
        <div className="relative" ref={profileRef}>
          <button
            onClick={() => setProfileMenuOpen(!profileMenuOpen)}
            className="flex items-center gap-2 h-9 min-h-[36px] rounded-xl border border-[#E2E8F0] bg-white px-2 pr-3 hover:bg-[#F8FAFC] transition-colors btn-pressable cursor-pointer shadow-2xs"
          >
            <div className="h-6 w-6 rounded-full bg-[#0F172A] text-white flex items-center justify-center text-[11px] font-semibold">
              A
            </div>
            <span className="text-[12.5px] font-medium text-[#0F172A] hidden sm:inline">Alex</span>
          </button>

          {profileMenuOpen && (
            <div className="absolute right-0 mt-2 w-52 rounded-xl border border-[#E2E8F0] bg-white shadow-lg py-1.5 z-50 animate-fade-in text-[12.5px]">
              <div className="px-3.5 py-2 border-b border-[#F1F5F9]">
                <p className="font-medium text-[#0F172A]">Alex Morgan</p>
                <p className="text-[11px] text-[#64748B]">alex@leadpilot.com</p>
              </div>

              <div className="py-1">
                <button
                  onClick={() => {
                    setProfileMenuOpen(false);
                    if (onNavigateTab) onNavigateTab('settings');
                  }}
                  className="w-full flex items-center gap-2 px-3.5 py-1.5 text-left text-[#334155] hover:bg-[#F8FAFC]"
                >
                  <Settings className="h-3.5 w-3.5 text-[#64748B]" />
                  <span>Workspace Settings</span>
                </button>
              </div>

            </div>
          )}
        </div>
      </div>
    </header>
  );
};
