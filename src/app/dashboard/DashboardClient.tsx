'use client';

import React, { useState } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { LeadSearchCard } from '@/components/dashboard/LeadSearchCard';
import { StatCards } from '@/components/dashboard/StatCards';
import { LeadsTable } from '@/components/dashboard/LeadsTable';
import { LeadDetailDrawer } from '@/components/dashboard/LeadDetailDrawer';
import { QuickAuditModal } from '@/components/dashboard/QuickAuditModal';
import { FindLeadsModal } from '@/components/dashboard/FindLeadsModal';
import { ExportModal } from '@/components/dashboard/ExportModal';
import { CommandPalette } from '@/components/common/CommandPalette';
import { ToastContainer } from '@/components/common/Toast';

import { FindLeadsView } from '@/components/views/FindLeadsView';
import { WebsiteAuditView } from '@/components/views/WebsiteAuditView';
import { CampaignsView } from '@/components/views/CampaignsView';
import { AIMessagesView } from '@/components/views/AIMessagesView';
import { DemoWebsitesView } from '@/components/views/DemoWebsitesView';
import { SettingsView } from '@/components/views/SettingsView';
import { OutreachTrackerView } from '@/components/outreach/OutreachTrackerView';
import { SenderAccountsManager } from '@/components/outreach/SenderAccountsManager';
import { SalesAssistantDrawer } from '@/components/assistant/SalesAssistantDrawer';
import { Bot } from 'lucide-react';


import { NavTab, Lead, ToastMessage, ContactFilter, WebsiteFilter, NumberOfLeads, SearchSummary, SearchStatusType, PipelineStats, ProviderStats, PipelineBreakdown, RejectedCandidateItem } from '@/types';
import { LeadFilterCriteria } from '@/components/dashboard/LeadSearchCard';
import { parseApiResponse, LeadPilotApiError } from '@/lib/apiClient';

export default function DashboardClient() {
  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Real Leads state (Loaded from canonical persistent database)
  const [leads, setLeads] = useState<Lead[]>([]);
  const [searchSummary, setSearchSummary] = useState<SearchSummary | null>(null);
  const [searchStatus, setSearchStatus] = useState<SearchStatusType | null>(null);
  const [pipelineStats, setPipelineStats] = useState<PipelineStats | null>(null);
  const [providerStats, setProviderStats] = useState<ProviderStats | null>(null);
  const [pipelineBreakdown, setPipelineBreakdown] = useState<PipelineBreakdown | null>(null);
  const [rotationStats, setRotationStats] = useState<any>(null);
  const [rejectedCandidates, setRejectedCandidates] = useState<RejectedCandidateItem[]>([]);
  const [rejectionReasons, setRejectionReasons] = useState<any>(null);
  const [statusReason, setStatusReason] = useState<string | null>(null);
  const [searchErrorMessage, setSearchErrorMessage] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [auditTargetLead, setAuditTargetLead] = useState<Lead | null>(null);

  // Load real persisted leads on initial mount
  React.useEffect(() => {
    fetch('/api/leads?limit=100')
      .then((res) => parseApiResponse(res, '/api/leads?limit=100'))
      .then((data) => {
        if (data.success && Array.isArray(data.leads) && data.leads.length > 0) {
          setLeads(data.leads);
          setHasSearched(true);
        }
      })
      .catch(() => {});
  }, []);


  // Modals & Panels state
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isFindLeadsModalOpen, setIsFindLeadsModalOpen] = useState(false);
  const [isQuickAuditModalOpen, setIsQuickAuditModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportSelectedLeads, setExportSelectedLeads] = useState<Lead[]>([]);
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);

  // Search lifecycle states
  const [hasSearched, setHasSearched] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [liveProgressLog, setLiveProgressLog] = useState<any[]>([]);

  // Toasts state
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

  // Global keyboard shortcut for Command Palette
  React.useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  const handleOpenQuickAudit = (lead?: Lead) => {
    setAuditTargetLead(lead || null);
    setIsQuickAuditModalOpen(true);
  };

  const handleOpenExport = (selected: Lead[] = []) => {
    setExportSelectedLeads(selected);
    setIsExportModalOpen(true);
  };

  const handleLeadSearchStart = () => {
    setIsSearching(true);
    setSearchErrorMessage(null);
    setLiveProgressLog([]);
  };

  const handleLeadSearchSubmit = async (criteria: LeadFilterCriteria) => {
    setIsSearching(true);
    setSearchErrorMessage(null);
    setLiveProgressLog([]);

    try {
      const response = await fetch('/api/leads/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          country: criteria.country || 'India',
          state: criteria.state,
          city: criteria.city,
          industry: criteria.industry,
          contactFilter: criteria.contact,
          websiteFilter: criteria.website,
          limit: criteria.limit,
          minRating: criteria.minRating,
          minReviews: criteria.minReviews,
          excludePerfectRating: criteria.excludePerfectRating,
          requirePositiveReviewEvidence: criteria.requirePositiveReviewEvidence,
          reviewSort: criteria.reviewSort,
          sync: true,
        }),
      });

      const initialData = await parseApiResponse(response, '/api/leads/search');

      if (!initialData.success && initialData.status === 'FAILED') {
        setIsSearching(false);
        setHasSearched(true);
        setLeads([]);
        setSearchSummary(null);
        setSearchStatus('FAILED');
        setPipelineStats(null);
        setStatusReason(initialData.error || 'Failed to dispatch search.');
        setSearchErrorMessage(initialData.error || 'Failed to dispatch search.');
        addToast('Search Notice', initialData.error || 'Failed to dispatch search.', 'warning');
        return;
      }

      // If returned synchronously directly (Fast Path ~1-2s)
      if (initialData.leads) {
        setIsSearching(false);
        setHasSearched(true);
        setLeads(initialData.leads || []);
        setSearchSummary(initialData.summary || null);
        setSearchStatus(initialData.searchStatus || (initialData.leads.length > 0 ? 'COMPLETE' : 'NO_RESULTS'));
        setPipelineStats(initialData.pipelineStats || null);
        setProviderStats(initialData.providerStats || null);
        setPipelineBreakdown(initialData.pipelineBreakdown || null);
        setRotationStats(initialData.rotationStats || null);
        setRejectedCandidates(initialData.rejectedCandidates || []);
        setRejectionReasons(initialData.rejectionReasons || null);
        setStatusReason(initialData.statusReason || null);
        setSearchErrorMessage(null);

        if (initialData.leads.length > 0) {
          const isPartial = initialData.searchStatus === 'PARTIAL';
          const deliveredCount = initialData.leads.length;
          const requestedCount = criteria.limit || 50;
          const title = isPartial
            ? `Discovery Complete (${deliveredCount}/${requestedCount} Leads)`
            : `Discovery Complete (${deliveredCount} Qualified Leads)`;
          const message = isPartial
            ? `Delivered ${deliveredCount} of ${requestedCount} leads across all configured discovery providers in ${criteria.city ? `${criteria.city}, ` : ''}${criteria.state}.`
            : `Discovered and verified ${deliveredCount} venues in ${criteria.city ? `${criteria.city}, ` : ''}${criteria.state}.`;

          addToast(title, message, isPartial ? 'info' : 'success');

          // If background enrichment jobs were queued, progressively update leads in background (Section 14)
          if (initialData.backgroundJobsQueued > 0 && initialData.jobId) {
            (async () => {
              for (let p = 0; p < 8; p++) {
                await new Promise((r) => setTimeout(r, 2000));
                try {
                  const bgRes = await fetch(`/api/leads/search/${initialData.jobId}/results`);
                  if (bgRes.ok) {
                    const bgData = await bgRes.json();
                    if (bgData.leads && bgData.leads.length > 0) {
                      setLeads(bgData.leads);
                      if (bgData.summary) setSearchSummary(bgData.summary);
                    }
                  }
                } catch {}
              }
            })();
          }
        } else {
          addToast(
            'Search Complete',
            `No matching businesses found in ${criteria.city ? `${criteria.city}, ` : ''}${criteria.state}.`,
            'info'
          );
        }
        return;
      }

      const jobId = initialData.jobId;
      if (!jobId) {
        throw new Error('No Job ID received from search engine.');
      }

      // Poll progress every 600ms
      let isDone = false;
      let attempts = 0;
      const maxAttempts = 150; // up to 90s

      while (!isDone && attempts < maxAttempts) {
        attempts++;
        await new Promise((r) => setTimeout(r, 600));

        const progRes = await fetch(`/api/leads/search/${jobId}/progress`);
        if (!progRes.ok) continue;

        const progData = await parseApiResponse(progRes, `/api/leads/search/${jobId}/progress`);
        if (progData.progressLog) {
          setLiveProgressLog(progData.progressLog);
        }

        if (progData.status === 'COMPLETED' || progData.status === 'DISCOVERY_COMPLETE' || progData.status === 'FAILED') {
          isDone = true;

          const resultsRes = await fetch(`/api/leads/search/${jobId}/results`);
          const resultsData = await parseApiResponse(resultsRes, `/api/leads/search/${jobId}/results`);

          setIsSearching(false);
          setHasSearched(true);

          if (resultsData.success) {
            setLeads(resultsData.leads || []);
            setSearchSummary(resultsData.summary || null);
            setSearchStatus(resultsData.searchStatus || (resultsData.leads?.length > 0 ? 'COMPLETE' : 'NO_RESULTS'));
            setPipelineStats(resultsData.pipelineStats || null);
            setProviderStats(resultsData.providerStats || null);
            setPipelineBreakdown(resultsData.pipelineBreakdown || null);
            setRotationStats(resultsData.rotationStats || null);
            setRejectedCandidates(resultsData.rejectedCandidates || []);
            setRejectionReasons(resultsData.rejectionReasons || null);
            setStatusReason(resultsData.statusReason || null);
            setSearchErrorMessage(null);

            if (resultsData.leads && resultsData.leads.length > 0) {
              const isPartial = resultsData.searchStatus === 'PARTIAL';
              const deliveredCount = resultsData.leads.length;
              const requestedCount = criteria.limit || 50;
              const title = isPartial
                ? `Discovery Complete (${deliveredCount}/${requestedCount} Leads)`
                : `Discovery Complete (${deliveredCount} Qualified Leads)`;
              const message = isPartial
                ? `Delivered ${deliveredCount} of ${requestedCount} leads across all configured discovery providers in ${criteria.city ? `${criteria.city}, ` : ''}${criteria.state}.`
                : `Discovered and verified ${deliveredCount} venues in ${criteria.city ? `${criteria.city}, ` : ''}${criteria.state}.`;

              addToast(title, message, isPartial ? 'info' : 'success');

              // If background enrichment jobs were queued, progressively update leads in background
              if (resultsData.backgroundJobsQueued > 0) {
                (async () => {
                  for (let p = 0; p < 8; p++) {
                    await new Promise((r) => setTimeout(r, 2000));
                    try {
                      const bgRes = await fetch(`/api/leads/search/${jobId}/results`);
                      if (bgRes.ok) {
                        const bgData = await bgRes.json();
                        if (bgData.leads && bgData.leads.length > 0) {
                          setLeads(bgData.leads);
                          if (bgData.summary) setSearchSummary(bgData.summary);
                        }
                      }
                    } catch {}
                  }
                })();
              }
            } else {
              addToast(
                'Search Complete',
                `No matching businesses found in ${criteria.city ? `${criteria.city}, ` : ''}${criteria.state}.`,
                'info'
              );
            }
          } else {
            setLeads([]);
            setSearchSummary(null);
            setSearchStatus('FAILED');
            setPipelineStats(null);
            setStatusReason(resultsData.error || 'Job failed.');
            setSearchErrorMessage(resultsData.error || 'Job failed.');
            addToast('Search Notice', resultsData.error || 'Job failed.', 'warning');
          }
          break;
        }
      }

      if (!isDone) {
        throw new Error('Search request timed out. Please try again.');
      }
    } catch (err: any) {
      setIsSearching(false);
      setHasSearched(true);
      setLeads([]);
      setSearchSummary(null);
      setSearchStatus('FAILED');
      setPipelineStats(null);
      setRotationStats(null);
      const msg = err instanceof LeadPilotApiError
        ? `${err.message}`
        : (err.message || 'Unable to connect to business search service.');
      setStatusReason(msg);
      setSearchErrorMessage(msg);
      addToast('Search Notice', msg, 'warning');
    }

  };

  const handleScrollToLeads = () => {
    const tableEl = document.getElementById('leads-section');
    if (tableEl) {
      tableEl.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="flex min-h-screen bg-[#F8F9FA] text-[#0F172A] font-sans antialiased">
      {/* 1. Clean Compact Left Sidebar */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 2. Top Header */}
        <Header
          activeTab={activeTab}
          onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
          onShowToast={addToast}
          onNavigateTab={setActiveTab}
        />

        {/* 3. Page Content Container */}
        <main className="flex-1 p-6 overflow-y-auto max-w-[1400px] w-full mx-auto space-y-6">
          {/* MAIN DASHBOARD (OVERVIEW) */}
          {activeTab === 'overview' && (
            <div className="space-y-6 animate-fade-in">
              {/* Search Configuration Section */}
              <LeadSearchCard
                isSearchingExternal={isSearching}
                liveProgressLog={liveProgressLog}
                onSearchStart={handleLeadSearchStart}
                onSearchSubmit={handleLeadSearchSubmit}
                onViewLeads={handleScrollToLeads}
              />

              {/* Dedicated Search Results Section */}
              <LeadsTable
                leads={leads}
                summary={searchSummary}
                searchStatus={searchStatus}
                pipelineStats={pipelineStats}
                providerStats={providerStats}
                pipelineBreakdown={pipelineBreakdown}
                rotationStats={rotationStats}
                rejectedCandidates={rejectedCandidates}
                rejectionReasons={rejectionReasons}
                statusReason={statusReason}
                errorMessage={searchErrorMessage}
                onSelectLead={setSelectedLead}
                onQuickAudit={handleOpenQuickAudit}
                onOpenExportModal={handleOpenExport}
                onShowToast={addToast}
                hasSearched={hasSearched}
                isSearching={isSearching}
              />
            </div>
          )}

          {/* ALL LEADS VIEW */}
          {activeTab === 'leads' && (
            <div className="space-y-5 animate-fade-in">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-5 rounded-2xl border border-[#E2E8F0] shadow-2xs">
                <div>
                  <h1 className="text-[17px] font-bold text-[#0F172A] tracking-tight">All Discovered Leads</h1>
                  <p className="text-[12.5px] text-[#64748B] mt-0.5">
                    Browse and inspect all businesses discovered by your searches.
                  </p>
                </div>
              </div>

              <LeadsTable
                leads={leads}
                summary={searchSummary}
                searchStatus={searchStatus}
                pipelineStats={pipelineStats}
                providerStats={providerStats}
                pipelineBreakdown={pipelineBreakdown}
                rejectedCandidates={rejectedCandidates}
                rejectionReasons={rejectionReasons}
                statusReason={statusReason}
                errorMessage={searchErrorMessage}
                onSelectLead={setSelectedLead}
                onQuickAudit={handleOpenQuickAudit}
                onOpenExportModal={handleOpenExport}
                onShowToast={addToast}
                hasSearched={true}
                isSearching={false}
              />
            </div>
          )}

          {/* FIND LEADS VIEW */}
          {activeTab === 'find-leads' && (
            <FindLeadsView
              onSelectLead={setSelectedLead}
              onOpenQuickAudit={handleOpenQuickAudit}
              onShowToast={addToast}
              onNavigate={(tab) => setActiveTab(tab)}
            />
          )}

          {/* WEBSITE AUDIT VIEW */}
          {activeTab === 'website-audit' && (
            <WebsiteAuditView
              leads={leads}
              onSelectLead={setSelectedLead}
              onOpenQuickAudit={handleOpenQuickAudit}
              onShowToast={addToast}
            />
          )}

          {/* CAMPAIGNS VIEW */}
          {activeTab === 'campaigns' && (
            <CampaignsView onShowToast={addToast} />
          )}

          {/* AI MESSAGES VIEW */}
          {activeTab === 'ai-messages' && (
            <AIMessagesView onShowToast={addToast} />
          )}

          {/* DEMO WEBSITES VIEW */}
          {activeTab === 'demo-websites' && (
            <DemoWebsitesView
              leads={leads}
              onSelectLead={setSelectedLead}
              onShowToast={addToast}
            />
          )}

          {/* OUTREACH HISTORY & AUDIT TRACKING VIEW */}
          {activeTab === 'outreach-history' && (
            <OutreachTrackerView />
          )}

          {/* SENDER MAILBOXES VIEW */}
          {activeTab === 'senders' && (
            <SenderAccountsManager />
          )}

          {/* SETTINGS VIEW */}
          {activeTab === 'settings' && (
            <SettingsView onShowToast={addToast} />
          )}
        </main>
      </div>

      {/* 7. Slide-over Lead Detail Drawer */}
      <LeadDetailDrawer
        lead={selectedLead}
        onClose={() => setSelectedLead(null)}
        onQuickAudit={handleOpenQuickAudit}
        onShowToast={addToast}
      />

      {/* Quick Audit Modal */}
      <QuickAuditModal
        isOpen={isQuickAuditModalOpen}
        lead={auditTargetLead}
        onClose={() => setIsQuickAuditModalOpen(false)}
        onShowToast={addToast}
      />

      {/* Find Leads Modal */}
      <FindLeadsModal
        isOpen={isFindLeadsModalOpen}
        onClose={() => setIsFindLeadsModalOpen(false)}
        onShowToast={addToast}
        onSearchSubmitted={(criteria) => {
          handleLeadSearchSubmit({
            country: 'India',
            state: criteria.state,
            city: criteria.city,
            industry: criteria.industry,
            contact: 'All Contacts',
            website: 'All Websites',
            limit: (criteria.limit as any) || 50,
          });
        }}
      />

      {/* Export Modal */}
      <ExportModal
        isOpen={isExportModalOpen}
        selectedLeads={exportSelectedLeads}
        onClose={() => setIsExportModalOpen(false)}
        onShowToast={addToast}
      />

      {/* Command Palette (Cmd + K) */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onNavigate={(tab) => {
          setActiveTab(tab);
          setIsCommandPaletteOpen(false);
        }}
        onSelectLead={(lead) => {
          setSelectedLead(lead);
          setIsCommandPaletteOpen(false);
        }}
        onOpenFindLeadsModal={() => {
          setIsCommandPaletteOpen(false);
          setIsFindLeadsModalOpen(true);
        }}
        onOpenQuickAudit={() => {
          setIsCommandPaletteOpen(false);
          setIsQuickAuditModalOpen(true);
        }}
        onOpenExportModal={() => {
          setIsCommandPaletteOpen(false);
          setIsExportModalOpen(true);
        }}
        leads={leads}
      />

      {/* Toast Notification Container */}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />

    </div>
  );
}
