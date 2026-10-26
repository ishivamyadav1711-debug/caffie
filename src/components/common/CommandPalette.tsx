'use client';

import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, 
  LayoutDashboard, 
  Users, 
  Globe2, 
  Send, 
  Sparkles, 
  MonitorPlay, 
  Settings, 
  HelpCircle, 
  Plus, 
  FileSearch, 
  Download, 
  ArrowRight,
  Command,
  Radar
} from 'lucide-react';
import { NavTab, Lead } from '@/types';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (tab: NavTab) => void;
  onSelectLead: (lead: Lead) => void;
  onOpenFindLeadsModal: () => void;
  onOpenQuickAudit: () => void;
  onOpenExportModal: () => void;
  leads: Lead[];
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  onNavigate,
  onSelectLead,
  onOpenFindLeadsModal,
  onOpenQuickAudit,
  onOpenExportModal,
  leads,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setSelectedIndex(0);
    } else {
      setQuery('');
    }
  }, [isOpen]);

  const quickActions = [
    {
      id: 'find-leads',
      label: 'Find New Business Leads',
      category: 'Discovery Action',
      icon: Plus,
      action: () => {
        onClose();
        onOpenFindLeadsModal();
      },
    },
    {
      id: 'run-audit',
      label: 'Run Quick Website Audit',
      category: 'Diagnostics Action',
      icon: FileSearch,
      action: () => {
        onClose();
        onOpenQuickAudit();
      },
    },
    {
      id: 'export-leads',
      label: 'Export Leads to CSV/Excel',
      category: 'Data Action',
      icon: Download,
      action: () => {
        onClose();
        onOpenExportModal();
      },
    },
  ];

  const navigationItems: { id: NavTab; label: string; icon: React.ElementType }[] = [
    { id: 'overview', label: 'Go to Dashboard Overview', icon: LayoutDashboard },
    { id: 'leads', label: 'Go to Leads Table', icon: Users },
    { id: 'website-audit', label: 'Go to Website Audits', icon: Globe2 },
    { id: 'campaigns', label: 'Go to Outreach Campaigns', icon: Send },
    { id: 'ai-messages', label: 'Go to AI Messages', icon: Sparkles },
    { id: 'demo-websites', label: 'Go to Demo Websites', icon: MonitorPlay },
    { id: 'social-leads', label: 'Go to B2B Social Leads (Hacker News & Reddit)', icon: Radar },
    { id: 'settings', label: 'Go to Settings', icon: Settings },
  ];

  const filteredActions = quickActions.filter((a) =>
    a.label.toLowerCase().includes(query.toLowerCase())
  );

  const filteredNav = navigationItems.filter((n) =>
    n.label.toLowerCase().includes(query.toLowerCase())
  );

  const filteredLeads = leads
    .filter(
      (l) =>
        l.businessName.toLowerCase().includes(query.toLowerCase()) ||
        l.industry.toLowerCase().includes(query.toLowerCase()) ||
        l.location.city.toLowerCase().includes(query.toLowerCase())
    )
    .slice(0, 5);

  const allItems: { type: 'action' | 'lead' | 'nav'; item: any; execute: () => void }[] = [
    ...filteredActions.map(a => ({ type: 'action' as const, item: a, execute: a.action })),
    ...filteredLeads.map(l => ({ type: 'lead' as const, item: l, execute: () => { onClose(); onSelectLead(l); } })),
    ...filteredNav.map(n => ({ type: 'nav' as const, item: n, execute: () => { onClose(); onNavigate(n.id); } })),
  ];

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev < allItems.length - 1 ? prev + 1 : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : allItems.length - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (allItems[selectedIndex]) {
          allItems[selectedIndex].execute();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, allItems, selectedIndex]);

  if (!isOpen) return null;

  let currentIndex = 0;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 bg-black/40 backdrop-blur-[2px] select-none animate-fade-in"
      onClick={onClose}
    >
      <div 
        className="relative w-full max-w-xl rounded-xl border border-[#E5E7EB] bg-white shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search bar input */}
        <div className="flex items-center px-4 py-3 border-b border-[#EAECEF] bg-[#FAFAFB]">
          <Search className="h-4 w-4 text-[#9CA3AF] mr-2.5 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a command or search leads, actions..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-transparent text-[13px] text-[#171717] placeholder-[#9CA3AF] focus:outline-none"
          />
          <kbd className="rounded border border-[#D1D5DB] bg-white px-1.5 py-0.5 text-[10px] font-medium text-[#6B7280]">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="max-h-80 overflow-y-auto p-2 space-y-3 text-[12.5px]">
          {/* Quick Actions */}
          {filteredActions.length > 0 && (
            <div>
              <div className="px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                Quick Actions
              </div>
              <div className="space-y-0.5">
                {filteredActions.map((action) => {
                  const itemIndex = currentIndex++;
                  const Icon = action.icon;
                  const isHighlighted = selectedIndex === itemIndex;

                  return (
                    <button
                      key={action.id}
                      onClick={action.action}
                      onMouseEnter={() => setSelectedIndex(itemIndex)}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-left transition-colors ${
                        isHighlighted ? 'bg-teal-50 text-teal-950 font-medium' : 'text-[#374151] hover:bg-[#F3F4F6]'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Icon className={`h-4 w-4 ${isHighlighted ? 'text-teal-700' : 'text-[#6B7280]'}`} />
                        <span className="font-medium text-[#171717]">{action.label}</span>
                      </div>
                      <span className="text-[11px] text-[#9CA3AF]">{action.category}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Lead Matches */}
          {query.trim() && filteredLeads.length > 0 && (
            <div>
              <div className="px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                Matching Leads
              </div>
              <div className="space-y-0.5">
                {filteredLeads.map((lead) => {
                  const itemIndex = currentIndex++;
                  const isHighlighted = selectedIndex === itemIndex;

                  return (
                    <button
                      key={lead.id}
                      onClick={() => {
                        onClose();
                        onSelectLead(lead);
                      }}
                      onMouseEnter={() => setSelectedIndex(itemIndex)}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-left transition-colors ${
                        isHighlighted ? 'bg-teal-50 text-teal-950 font-medium' : 'text-[#374151] hover:bg-[#F3F4F6]'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className="h-6 w-6 rounded bg-teal-100 text-teal-800 text-[10.5px] font-bold flex items-center justify-center shrink-0">
                          {lead.businessName.charAt(0)}
                        </div>
                        <div className="truncate">
                          <span className="font-medium text-[#171717] block leading-tight">
                            {lead.businessName}
                          </span>
                          <span className="text-[11px] text-[#6B7280]">
                            {lead.category} • {lead.location.city}, {lead.location.state}
                          </span>
                        </div>
                      </div>
                      <span className="text-[11px] font-semibold text-teal-800 tabular-nums">
                        Score {lead.leadScore}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Navigation */}
          {filteredNav.length > 0 && (
            <div>
              <div className="px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                Navigation
              </div>
              <div className="space-y-0.5">
                {filteredNav.map((nav) => {
                  const itemIndex = currentIndex++;
                  const Icon = nav.icon;
                  const isHighlighted = selectedIndex === itemIndex;

                  return (
                    <button
                      key={nav.id}
                      onClick={() => {
                        onClose();
                        onNavigate(nav.id);
                      }}
                      onMouseEnter={() => setSelectedIndex(itemIndex)}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-left transition-colors ${
                        isHighlighted ? 'bg-teal-50 text-teal-950 font-medium' : 'text-[#374151] hover:bg-[#F3F4F6]'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Icon className={`h-4 w-4 ${isHighlighted ? 'text-teal-700' : 'text-[#6B7280]'}`} />
                        <span>{nav.label}</span>
                      </div>
                      <ArrowRight className="h-3 w-3 text-[#9CA3AF] opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {filteredActions.length === 0 && filteredNav.length === 0 && filteredLeads.length === 0 && (
            <div className="py-8 text-center text-[12px] text-[#9CA3AF]">
              No matching commands found for &quot;{query}&quot;
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-[#EAECEF] bg-[#FAFAFB] flex items-center justify-between text-[11px] text-[#9CA3AF]">
          <div className="flex items-center gap-3">
            <span>Navigate: <kbd className="px-1 py-0.5 rounded border bg-white text-[#6B7280]">↑</kbd> <kbd className="px-1 py-0.5 rounded border bg-white text-[#6B7280]">↓</kbd></span>
            <span>Select: <kbd className="px-1 py-0.5 rounded border bg-white text-[#6B7280]">↵</kbd></span>
          </div>
          <span>LeadPilot Command Palette</span>
        </div>
      </div>
    </div>
  );
};
