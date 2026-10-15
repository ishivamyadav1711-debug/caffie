'use client';

import React from 'react';
import { 
  LayoutDashboard, 
  Search, 
  Users, 
  Globe2, 
  Sparkles, 
  MonitorPlay, 
  Send,
  Settings, 
  ChevronsLeft,
  ChevronsRight,
  Compass,
  Mail,
  Server
} from 'lucide-react';
import { NavTab } from '@/types';

interface SidebarProps {
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  unreadCount?: number;
}

interface NavSection {
  title: string;
  items: {
    id: NavTab;
    label: string;
    icon: React.ElementType;
    badge?: string;
  }[];
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  collapsed,
  setCollapsed,
}) => {
  const sections: NavSection[] = [
    {
      title: 'MAIN',
      items: [
        { id: 'overview', label: 'Dashboard', icon: LayoutDashboard },
        { id: 'find-leads', label: 'Find Leads', icon: Search },
        { id: 'leads', label: 'Leads', icon: Users, badge: '1.2k' },
      ],
    },
    {
      title: 'INTELLIGENCE',
      items: [
        { id: 'website-audit', label: 'Website Audit', icon: Globe2 },
        { id: 'demo-websites', label: 'Website Demos', icon: MonitorPlay },
        { id: 'ai-messages', label: 'AI Outreach', icon: Sparkles },
      ],
    },
    {
      title: 'OUTREACH & SENDERS',
      items: [
        { id: 'outreach-history', label: 'Outreach Tracking', icon: Mail },
        { id: 'senders', label: 'Sender Mailboxes', icon: Server },
        { id: 'campaigns', label: 'Campaigns', icon: Send },
        { id: 'settings', label: 'Settings', icon: Settings },
      ],
    },
  ];

  return (
    <aside 
      className={`relative flex flex-col border-r border-[#E5E7EB] bg-white transition-all duration-200 z-30 select-none ${
        collapsed ? 'w-[68px]' : 'w-[230px]'
      }`}
    >
      {/* Brand Header */}
      <div className="flex h-14 items-center justify-between px-4 border-b border-[#EAECEF]">
        <div className="flex items-center gap-2.5 overflow-hidden">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0F172A] text-white shadow-xs">
            <Compass className="h-4 w-4 text-teal-400" />
          </div>
          {!collapsed && (
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[14px] font-bold tracking-tight text-[#0F172A] leading-none">
                LeadPilot
              </span>
              <span className="inline-flex items-center px-1 py-0.2 text-[9px] font-semibold rounded bg-teal-50 text-teal-700 border border-teal-200/70">
                AI
              </span>
            </div>
          )}
        </div>

        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex h-7 w-7 min-h-[28px] min-w-[28px] items-center justify-center rounded-lg text-[#9CA3AF] hover:text-[#0F172A] hover:bg-[#F3F4F6] transition-colors btn-pressable cursor-pointer"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronsRight className="h-3.5 w-3.5" /> : <ChevronsLeft className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Navigation Sections */}
      <div className="flex-1 overflow-y-auto px-2.5 py-4 space-y-5">
        {sections.map((section) => (
          <div key={section.title} className="space-y-1">
            {!collapsed ? (
              <p className="px-2 text-[10px] font-semibold uppercase tracking-wider text-[#94A3B8]">
                {section.title}
              </p>
            ) : (
              <div className="h-px bg-[#E5E7EB] my-1.5 mx-1" />
            )}

            <div className="space-y-0.5 pt-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;

                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveTab(item.id)}
                    title={collapsed ? item.label : undefined}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 min-h-[38px] rounded-xl text-[13px] font-medium transition-colors group relative btn-pressable cursor-pointer ${
                      isActive
                        ? 'bg-[#0F172A] text-white font-medium shadow-xs'
                        : 'text-[#475569] hover:text-[#0F172A] hover:bg-[#F1F5F9]'
                    } ${collapsed ? 'justify-center px-0' : ''}`}
                  >
                    <Icon
                      className={`h-4 w-4 shrink-0 transition-colors ${
                        isActive ? 'text-teal-400' : 'text-[#64748B] group-hover:text-[#0F172A]'
                      }`}
                    />

                    {!collapsed && (
                      <span className="truncate text-left flex-1">{item.label}</span>
                    )}

                    {!collapsed && item.badge && (
                      <span
                        className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                          isActive
                            ? 'bg-slate-800 text-teal-300'
                            : 'bg-[#F1F5F9] text-[#64748B]'
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Subtle User Footer */}
      <div className="p-3 border-t border-[#EAECEF]">
        <div className={`flex items-center gap-2.5 px-1 ${collapsed ? 'justify-center' : ''}`}>
          <div className="h-7 w-7 rounded-full bg-[#0F172A] text-white flex items-center justify-center text-[11px] font-semibold shrink-0">
            A
          </div>
          {!collapsed && (
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-[12px] font-medium text-[#0F172A] truncate leading-tight">
                Alex Morgan
              </span>
              <span className="text-[10.5px] text-[#64748B] truncate leading-tight">
                Pro Plan • 1.2k Leads
              </span>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};
