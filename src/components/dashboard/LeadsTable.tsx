'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { 
  Search, 
  Download, 
  ChevronDown, 
  ChevronUp,
  FileSpreadsheet, 
  FileText, 
  X, 
  Mail, 
  Phone, 
  AlertCircle,
  ExternalLink,
  Loader2,
  Globe,
  MapPin,
  Building,
  AlertTriangle,
  Send,
  Sparkles
} from 'lucide-react';
import { BulkAIOutreachModal } from '../outreach/BulkAIOutreachModal';
import { 
  Lead, 
  SearchSummary,
  SearchStatusType,
  ProviderStats,
  PipelineBreakdown,
  RejectedCandidateItem
} from '@/types';

interface LeadsTableProps {
  leads: Lead[];
  summary?: SearchSummary | null;
  searchStatus?: SearchStatusType | null;
  pipelineStats?: any;
  providerStats?: ProviderStats | null;
  pipelineBreakdown?: PipelineBreakdown | null;
  rejectedCandidates?: RejectedCandidateItem[];
  rejectionReasons?: any;
  rotationStats?: {
    totalEvaluated: number;
    deliveredCount: number;
    newEligibleCount: number;
    recentlyDeliveredCount: number;
  };
  statusReason?: string | null;
  errorMessage?: string | null;
  onSelectLead: (lead: Lead) => void;
  onQuickAudit?: (lead: Lead) => void;
  onOpenExportModal?: (selectedLeads: Lead[]) => void;
  onShowToast: (title: string, desc?: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
  hasSearched?: boolean;
  isSearching?: boolean;
}

export const LeadsTable: React.FC<LeadsTableProps> = ({
  leads,
  summary,
  searchStatus,
  pipelineStats,
  providerStats,
  pipelineBreakdown,
  rejectedCandidates = [],
  rejectionReasons,
  rotationStats,
  statusReason,
  errorMessage,
  onSelectLead,
  onShowToast,
  hasSearched = false,
  isSearching = false,
}) => {
  // In-results search query (filters within returned real records)
  const [searchQuery, setSearchQuery] = useState('');
  const [isExportDropdownOpen, setIsExportDropdownOpen] = useState(false);
  const [showAuditPanel, setShowAuditPanel] = useState(false);
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [showBulkOutreachModal, setShowBulkOutreachModal] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  const toggleSelectLead = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedLeadIds((prev) => {
      const copy = new Set(prev);
      if (copy.has(id)) copy.delete(id);
      else copy.add(id);
      return copy;
    });
  };

  // Multi-Source transparency logic
  const googleCount = providerStats?.googlePlaces?.rawCount ?? 0;
  const googleStatus = providerStats?.googlePlaces?.status || 'PENDING';
  const osmCount = providerStats?.osm?.rawCount ?? pipelineStats?.rawOsmCount ?? 0;
  const osmStatus = providerStats?.osm?.status || 'NOT_NEEDED';
  const mergedUnique = pipelineBreakdown?.deduplicatedCount ?? pipelineStats?.deduplicatedCount ?? 0;
  const enrichedCount = pipelineBreakdown?.phoneOrEmailCount ?? summary?.hasPhoneOrEmail ?? 0;
  const requestedLimit = pipelineStats?.requestedLimit ?? 100;

  const isGoogleExecuted = googleCount > 0 && (googleStatus === 'COMPLETE' || googleStatus === 'SUCCESS' || googleStatus === 'PARTIAL');
  const providerLabel = 'PRIMARY: Google Places';

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 25;

  // Close export dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setIsExportDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Reset pagination when search query or leads change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, leads]);

  // Filter in-memory leads by in-results search bar
  const displayedLeads = useMemo(() => {
    if (!hasSearched) return [];
    const q = searchQuery.toLowerCase().trim();
    if (!q) return leads;

    return leads.filter((lead) => {
      return (
        lead.businessName.toLowerCase().includes(q) ||
        lead.industry.toLowerCase().includes(q) ||
        lead.location.city.toLowerCase().includes(q) ||
        (lead.location.address && lead.location.address.toLowerCase().includes(q)) ||
        (lead.contact.email && lead.contact.email.toLowerCase().includes(q)) ||
        (lead.contact.phone && lead.contact.phone.toLowerCase().includes(q)) ||
        (lead.website.url && lead.website.url.toLowerCase().includes(q))
      );
    });
  }, [leads, hasSearched, searchQuery]);

  // Pagination
  const totalPages = Math.ceil(displayedLeads.length / pageSize) || 1;
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedLeads = useMemo(() => {
    return displayedLeads.slice(startIndex, startIndex + pageSize);
  }, [displayedLeads, startIndex, pageSize]);

  // Dynamic calculated summary directly from real results (Section 10)
  const dynamicSummary: SearchSummary = useMemo(() => {
    if (summary) return summary;
    const withPhone = leads.filter((l) => l.contact.phone && l.contact.phone !== 'Not available' && l.contact.phone !== 'N/A').length;
    const withEmail = leads.filter((l) => l.contact.email && l.contact.email !== 'Not available' && l.contact.email !== 'N/A').length;
    const emailAndPhone = leads.filter(
      (l) => l.contact.phone && l.contact.phone !== 'Not available' && l.contact.phone !== 'N/A' && l.contact.email && l.contact.email !== 'Not available' && l.contact.email !== 'N/A'
    ).length;
    const hasPhoneOrEmail = leads.filter(
      (l) => (l.contact.phone && l.contact.phone !== 'Not available' && l.contact.phone !== 'N/A') || (l.contact.email && l.contact.email !== 'Not available' && l.contact.email !== 'N/A')
    ).length;
    const noContact = leads.filter(
      (l) => (!l.contact.phone || l.contact.phone === 'Not available' || l.contact.phone === 'N/A') && (!l.contact.email || l.contact.email === 'Not available' || l.contact.email === 'N/A')
    ).length;
    const noWebsite = leads.filter((l) => l.website.status === 'No Website' || !l.website.hasWebsite).length;
    const websiteAvailable = leads.filter((l) => Boolean(l.website.url) && l.website.status !== 'No Website').length;
    const workingWebsite = leads.filter((l) => l.website.status === 'Working' || l.website.status === 'Website Available').length;
    const needsImprovement = leads.filter(
      (l) => l.website.status === 'Needs Improvement' || l.website.status === 'Needs Website Improvement'
    ).length;
    const unreachable = leads.filter((l) => l.website.status === 'Unreachable' || l.website.status === 'Website Unreachable').length;

    return {
      total: leads.length,
      withPhone,
      withEmail,
      emailAndPhone,
      hasPhoneOrEmail,
      noContact,
      noWebsite,
      websiteAvailable,
      workingWebsite,
      needsImprovement,
      unreachable,
    };
  }, [leads, summary]);

  // Section 18: Real data review intelligence metrics
  const reviewMetrics = useMemo(() => {
    const withRating = leads.filter((l) => typeof l.rating === 'number' && l.rating > 0).length;
    const withReviews = leads.filter(
      (l) => (typeof l.reviewCount === 'number' && l.reviewCount > 0) || (typeof l.userRatingCount === 'number' && l.userRatingCount > 0)
    ).length;
    const totalReviews = leads.reduce((sum, l) => sum + (l.reviewCount || l.userRatingCount || 0), 0);
    const avgRating =
      withRating > 0
        ? (leads.filter((l) => typeof l.rating === 'number' && l.rating > 0).reduce((sum, l) => sum + (l.rating || 0), 0) / withRating).toFixed(1)
        : null;
    return { withRating, withReviews, totalReviews, avgRating };
  }, [leads]);

  // Section 36: Contact Action Tracking
  const handleContactAction = async (lead: Lead, action: string, channel: 'phone' | 'email' | 'whatsapp' | 'manual') => {
    try {
      const placeId = (lead as any).googlePlaceId || lead.osmId || lead.id;
      await fetch('/api/leads/contact-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placeId, leadId: lead.id, action, channel }),
      });
      onShowToast(`Recorded ${action}`, `Updated contact history for ${lead.businessName}.`, 'success');
    } catch (err: any) {
      console.warn('Failed to record contact action:', err);
    }
  };

  // Export handler
  const handleExport = (format: 'CSV' | 'Excel') => {
    setIsExportDropdownOpen(false);
    if (leads.length === 0) {
      onShowToast('Export Notice', 'No leads available to export.', 'info');
      return;
    }

    const headers = [
      'Business',
      'Industry',
      'Location',
      'Address',
      'Phone',
      'Email',
      'Website',
      'Website Status',
      'Website Issues',
      'Source'
    ];

    const rows = leads.map((l) => [
      `"${l.businessName.replace(/"/g, '""')}"`,
      `"${l.industry.replace(/"/g, '""')}"`,
      `"${l.location.city}${l.location.state ? `, ${l.location.state}` : ''}"`,
      `"${(l.location.address || '').replace(/"/g, '""')}"`,
      `"${l.contact.phone || 'Not available'}"`,
      `"${l.contact.email || 'Not available'}"`,
      `"${l.website.url || 'Not available'}"`,
      `"${l.website.status}"`,
      `"${(l.website.detectedIssues || []).join('; ').replace(/"/g, '""')}"`,
      `"${l.source || 'Google Places + Firecrawl'}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `leads_export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    onShowToast(`Exported ${leads.length} Leads`, `Saved as ${format} file.`, 'success');
  };

  // Render Website Status Cell
  const renderWebsiteStatusCell = (lead: Lead) => {
    const isNoWeb = !lead.website.hasWebsite || lead.website.status === 'No Website' || !lead.website.url;
    const isUnreachable = 
      lead.website.status === 'Unreachable' || 
      lead.website.status === 'Website Unreachable';
    const isNeedsImprovement = 
      lead.website.status === 'Needs Improvement' || 
      lead.website.status === 'Needs Website Improvement';

    if (isNoWeb) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10.5px] font-semibold uppercase tracking-wider bg-slate-100 text-slate-600 border border-slate-200">
          <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
          No Website
        </span>
      );
    }

    if (isUnreachable) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10.5px] font-semibold uppercase tracking-wider bg-rose-50 text-rose-700 border border-rose-200">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
          Unreachable
        </span>
      );
    }

    if (isNeedsImprovement) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10.5px] font-semibold uppercase tracking-wider bg-amber-50 text-amber-800 border border-amber-200">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          Needs Improvement
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10.5px] font-semibold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Working
      </span>
    );
  };

  // Export Outreach Report (.xlsx) from real canonical database records
  const handleExportOutreachExcel = () => {
    setIsExportDropdownOpen(false);
    window.location.href = '/api/outreach/export';
    onShowToast('Export Started', 'Generating 27-column Outreach Report (.xlsx)...', 'success');
  };

  // Render Outreach Status Cell
  const renderOutreachStatusCell = (lead: Lead) => {
    const raw = String(lead.outreachStatus || '').toUpperCase();

    if (raw === 'SENT' || raw === 'DELIVERED' || raw === 'READ') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-semibold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          {raw === 'DELIVERED' ? 'Delivered' : raw === 'READ' ? 'Read' : 'Sent'}
        </span>
      );
    }

    if (raw === 'QUEUED' || raw === 'SENDING' || raw === 'PENDING') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-semibold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
          Queued
        </span>
      );
    }

    if (raw === 'FAILED' || raw === 'BOUNCED') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-semibold uppercase tracking-wider bg-rose-50 text-rose-700 border border-rose-200">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
          {raw === 'BOUNCED' ? 'Bounced' : 'Failed'}
        </span>
      );
    }

    if (raw === 'SUPPRESSED') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-semibold uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          Suppressed
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-medium text-slate-500 bg-slate-50 border border-slate-200">
        Not Contacted
      </span>
    );
  };

  return (
    <div id="leads-section" className="rounded-2xl border border-[#E2E8F0] bg-white shadow-xs overflow-hidden">
      {/* 1. DEDICATED RESULTS HEADER */}
      <div className="p-4 sm:p-5 border-b border-[#E2E8F0] flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white">
        <div>
          <h2 className="text-[13px] font-bold text-[#475569] tracking-wider uppercase">
            Search Results
          </h2>
          {hasSearched && !isSearching && leads.length > 0 && (
            <p className="text-[12px] text-[#64748B] mt-0.5">
              {leads.length} {leads.length === 1 ? 'real business' : 'real businesses'} discovered via Google Places, OpenStreetMap & Website Audit
            </p>
          )}
        </div>

        <div className="flex items-center gap-2.5">
          {/* Search input for finding a specific business inside the results */}
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#94A3B8]" />
            <input
              type="text"
              placeholder="Search businesses..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              disabled={!hasSearched || isSearching || leads.length === 0}
              className="w-full h-9 min-h-[36px] pl-9 pr-8 rounded-xl border border-[#CBD5E1] bg-white text-[12px] text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#0F172A] focus:outline-none transition-all shadow-2xs disabled:bg-[#F8FAFC] disabled:cursor-not-allowed"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#0F172A] p-0.5 rounded cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Multi-Select AI Outreach Action Button */}
          {selectedLeadIds.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-700 bg-slate-100 px-2.5 py-1.5 rounded-xl border border-slate-200">
                {selectedLeadIds.size} selected
              </span>
              <button
                onClick={() => setShowBulkOutreachModal(true)}
                className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-[12px] font-semibold shadow-xs transition-colors cursor-pointer"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>AI Outreach ({selectedLeadIds.size})</span>
              </button>
            </div>
          )}

          {/* Export Button */}
          <div className="relative" ref={exportRef}>
            <button
              onClick={() => setIsExportDropdownOpen(!isExportDropdownOpen)}
              disabled={!hasSearched || isSearching || leads.length === 0}
              className="inline-flex items-center gap-1.5 h-9 min-h-[36px] px-3.5 rounded-xl border border-[#CBD5E1] bg-white text-[12px] font-medium text-[#0F172A] hover:bg-[#F8FAFC] transition-colors shadow-2xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className="h-3.5 w-3.5 text-[#64748B]" />
              <span>Export</span>
              <ChevronDown className="h-3 w-3 text-[#94A3B8]" />
            </button>

            {isExportDropdownOpen && (
              <div className="absolute right-0 mt-1.5 w-48 rounded-xl border border-[#E2E8F0] bg-white shadow-lg py-1 z-30 animate-popover text-[12px]">
                <button
                  onClick={() => handleExport('CSV')}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-[#334155] hover:bg-[#F8FAFC] hover:text-[#0F172A] transition-colors cursor-pointer"
                >
                  <FileText className="h-3.5 w-3.5 text-teal-600" />
                  <span>Leads (CSV)</span>
                </button>
                <button
                  onClick={() => handleExport('Excel')}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-[#334155] hover:bg-[#F8FAFC] hover:text-[#0F172A] transition-colors cursor-pointer"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
                  <span>Leads (Excel)</span>
                </button>
                <div className="border-t border-slate-100 my-1" />
                <button
                  onClick={handleExportOutreachExcel}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-teal-800 font-semibold hover:bg-teal-50/50 transition-colors cursor-pointer"
                >
                  <Send className="h-3.5 w-3.5 text-teal-600" />
                  <span>Outreach Report (.xlsx)</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 1.5 DIAGNOSTIC PIPELINE STATUS BAR (TRANSPARENCY) */}
      {hasSearched && !isSearching && (pipelineStats || pipelineBreakdown) && (
        <div className="px-5 py-2.5 bg-slate-900 text-slate-300 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 text-[11.5px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-white flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${
                searchStatus === 'COMPLETE'
                  ? 'bg-teal-400'
                  : searchStatus === 'PROVIDER_FAILURE'
                  ? 'bg-rose-400'
                  : searchStatus === 'PROVIDER_NOT_CONFIGURED'
                  ? 'bg-amber-400'
                  : 'bg-blue-400 animate-pulse'
              }`} />
              {providerLabel}
            </span>
            <span className="text-slate-600">|</span>
            <span>Google: <strong className="text-white">
              {googleStatus === 'PROVIDER_NOT_CONFIGURED' || googleStatus === 'NOT_CONFIGURED' || googleStatus === 'DISABLED'
                ? 'Not Configured'
                : googleStatus === 'AUTH_FAILED'
                ? 'Auth Failed'
                : googleStatus === 'RATE_LIMITED'
                ? 'Rate Limited'
                : googleStatus === 'REQUEST_FAILED' || googleStatus === 'PROVIDER_FAILURE' || googleStatus === 'FAILED'
                ? 'Failed'
                : googleStatus === 'NO_RESULTS'
                ? 'No Results'
                : googleStatus === 'PENDING'
                ? 'Pending'
                : googleStatus === 'COMPLETE' || googleStatus === 'SUCCESS' || googleStatus === 'PARTIAL'
                ? (googleCount > 0 ? `Active (${googleCount})` : 'Active')
                : googleStatus}
            </strong></span>
            <span>•</span>
            <span>OSM: <strong className="text-white">
              {osmStatus === 'COMPLETE' || osmStatus === 'SUCCESS'
                ? (osmCount > 0 ? `Active (${osmCount})` : 'Active')
                : osmStatus === 'NO_RESULTS'
                ? 'No Results'
                : osmStatus === 'NOT_CONFIGURED' || osmStatus === 'DISABLED'
                ? 'Disabled'
                : osmStatus === 'RATE_LIMITED'
                ? 'Rate Limited'
                : osmStatus === 'REQUEST_FAILED' || osmStatus === 'FAILED'
                ? 'Failed'
                : osmStatus === 'SUPPLEMENTAL' || osmStatus === 'NOT_NEEDED'
                ? (osmCount > 0 ? `Active (${osmCount})` : 'Supplemental')
                : osmStatus}
            </strong></span>
            <span>•</span>
            <span>Merged: <strong className="text-white">{mergedUnique}</strong></span>
            <span>•</span>
            <span>Enriched: <strong className="text-white">{enrichedCount}</strong></span>
            <span>•</span>
            <span>Delivered: <strong className="text-teal-300 font-bold">{leads.length}</strong> / {requestedLimit}</span>
          </div>

          <div className="flex items-center gap-2.5">
            {rejectedCandidates && rejectedCandidates.length > 0 && (


              <button
                type="button"
                onClick={() => setShowAuditPanel(!showAuditPanel)}
                className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer border border-slate-700"
                title="View detailed pipeline audit & candidate diagnostics"
              >
                <span>View Search Details ({rejectedCandidates.length})</span>
                {showAuditPanel ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
            )}

            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase ${
              searchStatus === 'COMPLETE' ? 'bg-teal-500/20 text-teal-300 border border-teal-500/30' : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
            }`}>
              Status: {searchStatus || 'COMPLETE'}
            </span>
            {statusReason && <span className="text-slate-400 italic text-[11px] max-w-md truncate hidden md:inline">({statusReason})</span>}
          </div>
        </div>
      )}

      {/* 1.6 COLLAPSIBLE REJECTIONS AUDIT PANEL (WHEN TOGGLED) */}
      {showAuditPanel && rejectedCandidates && rejectedCandidates.length > 0 && (
        <div className="bg-[#0F172A] text-slate-200 border-b border-slate-800 p-5 space-y-4 text-[12px] animate-fade-in">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-white text-[13px] uppercase tracking-wider flex items-center gap-2">
              Search Diagnostics &amp; Candidate Audit ({rejectedCandidates.length} evaluated)
            </h4>

            <button
              onClick={() => setShowAuditPanel(false)}
              className="text-slate-400 hover:text-white text-[11px]"
            >
              Close
            </button>
          </div>

          {/* Genuine Diversification Diagnostics */}
          {rotationStats && (
            <div className="flex flex-wrap items-center gap-2 text-[11px] bg-slate-900/50 p-3 rounded-lg border border-slate-800">
              <span className="font-bold text-slate-300">DIVERSIFICATION (DB STATE):</span>
              <span className="px-2.5 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700">
                TOTAL CANDIDATES: <strong className="text-white">{rotationStats.totalEvaluated}</strong>
              </span>
              <span className="px-2.5 py-1 rounded bg-teal-950/40 text-teal-300 border border-teal-800/50">
                NEW/UNSEEN (ELIGIBLE): <strong className="text-white">{rotationStats.newEligibleCount}</strong>
              </span>
              <span className="px-2.5 py-1 rounded bg-rose-950/40 text-rose-300 border border-rose-800/50">
                RECENTLY DELIVERED (EXCLUDED): <strong className="text-white">{rotationStats.recentlyDeliveredCount}</strong>
              </span>
              <span className="px-2.5 py-1 rounded bg-emerald-950/40 text-emerald-300 border border-emerald-800/50">
                FINAL DIVERSIFIED: <strong className="text-white">{rotationStats.deliveredCount}</strong>
              </span>
            </div>
          )}

          {/* Rejection Reasons Summary Tags */}
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="px-2.5 py-1 rounded bg-amber-950/40 text-amber-300 border border-amber-800/50">
              NO_CONTACT: <strong className="text-white">{rejectionReasons?.NO_CONTACT ?? 0}</strong>
            </span>
            <span className="px-2.5 py-1 rounded bg-blue-950/40 text-blue-300 border border-blue-800/50">
              HAS_WEBSITE: <strong className="text-white">{rejectionReasons?.HAS_WEBSITE ?? 0}</strong>
            </span>
            <span className="px-2.5 py-1 rounded bg-rose-950/40 text-rose-300 border border-rose-800/50">
              NO_WEBSITE: <strong className="text-white">{rejectionReasons?.NO_WEBSITE ?? 0}</strong>
            </span>
            <span className="px-2.5 py-1 rounded bg-purple-950/40 text-purple-300 border border-purple-800/50">
              WEBSITE_UNREACHABLE: <strong className="text-white">{rejectionReasons?.WEBSITE_UNREACHABLE ?? 0}</strong>
            </span>
            <span className="px-2.5 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700">
              OUTSIDE_LOCATION: <strong className="text-white">{rejectionReasons?.OUTSIDE_LOCATION ?? 0}</strong>
            </span>
            <span className="px-2.5 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700">
              DUPLICATE: <strong className="text-white">{rejectionReasons?.DUPLICATE ?? 0}</strong>
            </span>
            <span className="px-2.5 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700">
              MISSING_NAME: <strong className="text-white">{rejectionReasons?.MISSING_NAME ?? 0}</strong>
            </span>
            <span className="px-2.5 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700">
              OTHER: <strong className="text-white">{rejectionReasons?.OTHER ?? 0}</strong>
            </span>
          </div>

          {/* Candidates table */}
          <div className="max-h-60 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/50">
            <table className="w-full text-left text-[11.5px] border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900 text-slate-400 font-semibold uppercase text-[10.5px]">
                  <th className="px-3 py-2">Business</th>
                  <th className="px-3 py-2">Phone</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Website</th>
                  <th className="px-3 py-2">Rejection Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {rejectedCandidates.map((c, i) => (
                  <tr key={i} className="hover:bg-slate-900/60">
                    <td className="px-3 py-2 font-medium text-white">{c.name}</td>
                    <td className="px-3 py-2 text-slate-300">{c.phone || <span className="text-slate-600">None</span>}</td>
                    <td className="px-3 py-2 text-slate-300">{c.email || <span className="text-slate-600">None</span>}</td>
                    <td className="px-3 py-2 text-slate-300">{c.websiteUrl ? c.websiteUrl.replace(/^https?:\/\//, '') : <span className="text-slate-600">None</span>}</td>
                    <td className="px-3 py-2 font-semibold">
                      <span className={`px-2 py-0.5 rounded text-[10px] ${
                        c.rejectionReason === 'NO_CONTACT' ? 'bg-amber-950/60 text-amber-300 border border-amber-800/60' :
                        c.rejectionReason === 'HAS_WEBSITE' ? 'bg-blue-950/60 text-blue-300 border border-blue-800/60' :
                        c.rejectionReason === 'NO_WEBSITE' ? 'bg-rose-950/60 text-rose-300 border border-rose-800/60' :
                        'bg-slate-800 text-slate-300'
                      }`}>
                        {c.rejectionReason}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 2. DYNAMIC REAL SUMMARY BAR (SECTION 10) */}
      {hasSearched && !isSearching && leads.length > 0 && (
        <div className="px-5 py-3 bg-[#F8FAFC] border-b border-[#E2E8F0] flex flex-wrap items-center gap-3 text-[12px]">
          <span className="font-bold text-[#0F172A]">
            {dynamicSummary.total} Businesses Found
          </span>
          <span className="text-[#CBD5E1]">•</span>
          <span className="text-[#334155] font-medium">
            <strong className="text-[#0F172A]">{dynamicSummary.hasPhoneOrEmail}</strong> Phone or Email
          </span>
          <span className="text-[#CBD5E1]">•</span>
          <span className="text-[#334155] font-medium">
            <strong className="text-[#0F172A]">{dynamicSummary.withPhone}</strong> Phone
          </span>
          <span className="text-[#CBD5E1]">•</span>
          <span className="text-[#334155] font-medium">
            <strong className="text-[#0F172A]">{dynamicSummary.websiteAvailable}</strong> Website
          </span>
          {reviewMetrics.withRating > 0 && (
            <>
              <span className="text-[#CBD5E1]">•</span>
              <span className="text-[#334155] font-medium">
                <strong className="text-amber-700">{reviewMetrics.withRating}</strong> Rated ({reviewMetrics.avgRating} ★ avg)
              </span>
              <span className="text-[#CBD5E1]">•</span>
              <span className="text-[#334155] font-medium">
                <strong className="text-teal-700">{reviewMetrics.totalReviews}</strong> Total Reviews
              </span>
            </>
          )}
          <span className="text-[#CBD5E1]">•</span>
          <span className="text-[#334155] font-medium">
            <strong className="text-emerald-700">{dynamicSummary.workingWebsite}</strong> Working Website
          </span>
          <span className="text-[#CBD5E1]">•</span>
          <span className="text-[#334155] font-medium">
            <strong className="text-amber-700">{dynamicSummary.needsImprovement}</strong> Needs Improvement
          </span>
          {dynamicSummary.unreachable > 0 && (
            <>
              <span className="text-[#CBD5E1]">•</span>
              <span className="text-[#334155] font-medium">
                <strong className="text-red-700">{dynamicSummary.unreachable}</strong> Unreachable
              </span>
            </>
          )}
        </div>
      )}

      {/* 3. MAIN TABLE / STATES */}
      <div className="overflow-x-auto min-h-[300px]">
        {/* State A: Before Search is Run */}
        {!hasSearched && !isSearching && (
          <div className="flex flex-col items-center justify-center py-20 px-4 text-center animate-fade-in">
            <div className="h-12 w-12 rounded-2xl bg-[#F8FAFC] flex items-center justify-center text-[#64748B] mb-3.5 border border-[#E2E8F0]">
              <Search className="h-5 w-5 text-[#64748B]" />
            </div>
            <h3 className="text-[16px] font-bold text-[#0F172A]">
              Ready to find leads
            </h3>
            <p className="text-[13px] text-[#64748B] max-w-md mt-1.5 leading-relaxed">
              Choose your criteria and find real businesses.
            </p>
          </div>
        )}

        {/* State B: Search In Progress */}
        {isSearching && (
          <div className="flex flex-col items-center justify-center py-20 px-4 text-center animate-fade-in">
            <div className="h-12 w-12 rounded-2xl bg-teal-50 flex items-center justify-center text-teal-700 mb-3.5 border border-teal-200">
              <Loader2 className="h-6 w-6 animate-spin text-teal-700" />
            </div>
            <h3 className="text-[16px] font-bold text-[#0F172A]">
              Finding real businesses on Google Places & Firecrawl...
            </h3>
            <p className="text-[13px] text-[#64748B] max-w-md mt-1.5 leading-relaxed">
              Crawling websites, extracting verified emails, and analyzing technical quality.
            </p>
          </div>
        )}

        {/* State C: API Error */}
        {hasSearched && !isSearching && errorMessage && (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center animate-fade-in">
            <div className="h-12 w-12 rounded-2xl bg-amber-50 flex items-center justify-center text-amber-700 mb-3.5 border border-amber-200">
              <AlertTriangle className="h-6 w-6 text-amber-600" />
            </div>
            <h3 className="text-[16px] font-bold text-[#0F172A]">
              Lead Search Notice
            </h3>
            <p className="text-[13px] text-[#475569] max-w-lg mt-1.5 leading-relaxed">
              {errorMessage}
            </p>
          </div>
        )}


        {/* State D: Search Finished, Zero Results or Provider Issues */}
        {hasSearched && !isSearching && !errorMessage && leads.length === 0 && (
          <div className="p-6 space-y-6 animate-fade-in">
            {searchStatus === 'PROVIDER_NOT_CONFIGURED' ? (
              <div className="flex flex-col items-center justify-center py-6 px-4 text-center">
                <div className="h-12 w-12 rounded-2xl bg-amber-50 flex items-center justify-center text-amber-600 mb-3 border border-amber-200">
                  <AlertTriangle className="h-6 w-6 text-amber-600" />
                </div>
                <h3 className="text-[16px] font-bold text-[#0F172A]">
                  Google Places Provider Not Configured
                </h3>
                <p className="text-[13px] text-[#64748B] max-w-lg mt-1 leading-relaxed">
                  Google Places is designated as Primary Discovery Provider, but <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-[11px] font-mono">GOOGLE_PLACES_API_KEY</code> is not configured on the server. OpenStreetMap fallback was executed.
                </p>
              </div>
            ) : searchStatus === 'PROVIDER_FAILURE' ? (
              <div className="flex flex-col items-center justify-center py-6 px-4 text-center">
                <div className="h-12 w-12 rounded-2xl bg-rose-50 flex items-center justify-center text-rose-600 mb-3 border border-rose-200">
                  <AlertCircle className="h-6 w-6 text-rose-600" />
                </div>
                <h3 className="text-[16px] font-bold text-[#0F172A]">
                  Discovery Provider Failure
                </h3>
                <p className="text-[13px] text-[#64748B] max-w-lg mt-1 leading-relaxed">
                  External discovery providers encountered an upstream network failure or timeout. Please check server connectivity or retry with a narrower city query.
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-6 px-4 text-center">
                <div className="h-12 w-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-600 mb-3 border border-slate-200">
                  <AlertCircle className="h-6 w-6 text-slate-600" />
                </div>
                <h3 className="text-[16px] font-bold text-[#0F172A]">
                  0 Qualified Leads Delivered
                </h3>
                <p className="text-[13px] text-[#64748B] max-w-lg mt-1 leading-relaxed">
                  The pipeline discovered {pipelineBreakdown?.rawDiscoveredCount || pipelineStats?.rawOsmCount || 0} candidate businesses, but none satisfied the required filter criteria. Complete rejection breakdown is detailed below.
                </p>
              </div>
            )}

            {/* Rejection Breakdown Counters (11 items) */}
            <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4">
              <h4 className="text-[12px] font-bold text-[#0F172A] uppercase tracking-wider mb-3">
                Pipeline Execution Breakdown
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5 text-[11.5px]">
                <div className="bg-white p-2.5 rounded-lg border border-[#E2E8F0]">
                  <div className="text-[#64748B] text-[10.5px]">Raw Discovered</div>
                  <div className="text-[15px] font-bold text-[#0F172A]">{pipelineBreakdown?.rawDiscoveredCount ?? pipelineStats?.rawOsmCount ?? 0}</div>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-[#E2E8F0]">
                  <div className="text-[#64748B] text-[10.5px]">Normalized</div>
                  <div className="text-[15px] font-bold text-[#0F172A]">{pipelineBreakdown?.normalizedCount ?? (pipelineStats?.rawOsmCount ?? 0)}</div>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-[#E2E8F0]">
                  <div className="text-[#64748B] text-[10.5px]">Location Verified</div>
                  <div className="text-[15px] font-bold text-[#0F172A]">{pipelineBreakdown?.locationVerifiedCount ?? pipelineBreakdown?.inCityBoundsCount ?? pipelineStats?.inCityBoundsCount ?? 0}</div>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-[#E2E8F0]">
                  <div className="text-[#64748B] text-[10.5px]">Deduplicated</div>
                  <div className="text-[15px] font-bold text-[#0F172A]">{pipelineBreakdown?.deduplicatedCount ?? pipelineStats?.deduplicatedCount ?? 0}</div>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-[#E2E8F0]">
                  <div className="text-[#64748B] text-[10.5px]">Phone Available</div>
                  <div className="text-[15px] font-bold text-[#0F172A]">{pipelineBreakdown?.phoneCount ?? 0}</div>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-[#E2E8F0]">
                  <div className="text-[#64748B] text-[10.5px]">Email Available</div>
                  <div className="text-[15px] font-bold text-[#0F172A]">{pipelineBreakdown?.emailCount ?? 0}</div>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-[#E2E8F0]">
                  <div className="text-[#64748B] text-[10.5px]">Phone OR Email</div>
                  <div className="text-[15px] font-bold text-blue-700">{pipelineBreakdown?.phoneOrEmailCount ?? 0}</div>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-[#E2E8F0]">
                  <div className="text-[#64748B] text-[10.5px]">Website Available</div>
                  <div className="text-[15px] font-bold text-emerald-700">{pipelineBreakdown?.websiteAvailableCount ?? 0}</div>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-[#E2E8F0]">
                  <div className="text-[#64748B] text-[10.5px]">Verified No Website</div>
                  <div className="text-[15px] font-bold text-rose-700">{pipelineBreakdown?.websiteUnavailableCount ?? 0}</div>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-[#E2E8F0]">
                  <div className="text-[#64748B] text-[10.5px]">Website Unreachable</div>
                  <div className="text-[15px] font-bold text-amber-700">{pipelineBreakdown?.websiteUnreachableCount ?? 0}</div>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-teal-200 col-span-2 sm:col-span-1">
                  <div className="text-teal-700 text-[10.5px] font-semibold">Final Qualified</div>
                  <div className="text-[15px] font-bold text-teal-800">{pipelineBreakdown?.finalQualifiedCount ?? leads.length}</div>
                </div>
              </div>
            </div>

            {/* Rejection Reasons Summary Tags */}
            <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4">
              <h4 className="text-[12px] font-bold text-[#0F172A] uppercase tracking-wider mb-2.5">
                Exact Rejection Reasons
              </h4>
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="px-2.5 py-1 rounded-md bg-amber-50 text-amber-800 border border-amber-200 font-medium">
                  NO_CONTACT: <strong>{rejectionReasons?.NO_CONTACT ?? 0}</strong>
                </span>
                <span className="px-2.5 py-1 rounded-md bg-blue-50 text-blue-800 border border-blue-200 font-medium">
                  HAS_WEBSITE: <strong>{rejectionReasons?.HAS_WEBSITE ?? 0}</strong>
                </span>
                <span className="px-2.5 py-1 rounded-md bg-rose-50 text-rose-800 border border-rose-200 font-medium">
                  NO_WEBSITE: <strong>{rejectionReasons?.NO_WEBSITE ?? 0}</strong>
                </span>
                <span className="px-2.5 py-1 rounded-md bg-purple-50 text-purple-800 border border-purple-200 font-medium">
                  WEBSITE_UNREACHABLE: <strong>{rejectionReasons?.WEBSITE_UNREACHABLE ?? 0}</strong>
                </span>
                <span className="px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 border border-slate-200 font-medium">
                  OUTSIDE_LOCATION: <strong>{rejectionReasons?.OUTSIDE_LOCATION ?? 0}</strong>
                </span>
                {(rejectionReasons?.UNKNOWN_LOCATION ?? 0) > 0 && (
                  <span className="px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 border border-slate-200 font-medium">
                    UNKNOWN_LOCATION: <strong>{rejectionReasons.UNKNOWN_LOCATION}</strong>
                  </span>
                )}
                <span className="px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 border border-slate-200 font-medium">
                  DUPLICATE: <strong>{rejectionReasons?.DUPLICATE ?? 0}</strong>
                </span>
                <span className="px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 border border-slate-200 font-medium">
                  MISSING_NAME: <strong>{rejectionReasons?.MISSING_NAME ?? 0}</strong>
                </span>
                <span className="px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 border border-slate-200 font-medium">
                  OTHER: <strong>{rejectionReasons?.OTHER ?? 0}</strong>
                </span>
              </div>
            </div>

            {/* Discovered Candidates Rejection Inspection Table */}
            {rejectedCandidates && rejectedCandidates.length > 0 && (
              <div className="border border-[#E2E8F0] rounded-xl overflow-hidden">
                <div className="bg-[#F8FAFC] px-4 py-2.5 border-b border-[#E2E8F0] flex items-center justify-between">
                  <h4 className="text-[12px] font-bold text-[#0F172A] uppercase tracking-wider">
                    Discovered Candidates &amp; Rejection Audit ({rejectedCandidates.length})
                  </h4>
                  <span className="text-[11px] text-[#64748B]">All candidates evaluated by LeadPilot Pipeline</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[12px] border-collapse">
                    <thead>
                      <tr className="bg-[#F8FAFC] text-[11px] font-semibold text-[#64748B] uppercase tracking-wider border-b border-[#E2E8F0]">
                        <th className="px-4 py-2.5">Candidate Name</th>
                        <th className="px-3 py-2.5">Category</th>
                        <th className="px-3 py-2.5">Location</th>
                        <th className="px-3 py-2.5">Phone</th>
                        <th className="px-3 py-2.5">Email</th>
                        <th className="px-3 py-2.5">Website Status</th>
                        <th className="px-4 py-2.5">Rejection Reason</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F1F5F9]">
                      {rejectedCandidates.map((candidate, idx) => (
                        <tr key={idx} className="hover:bg-[#F8FAFC] transition-colors">
                          <td className="px-4 py-2.5 font-semibold text-[#0F172A]">
                            {candidate.name}
                          </td>
                          <td className="px-3 py-2.5 text-[#475569]">
                            {candidate.category || 'Restaurant'}
                          </td>
                          <td className="px-3 py-2.5 text-[#475569]">
                            {candidate.city ? `${candidate.city}${candidate.state ? `, ${candidate.state}` : ''}` : (candidate.state || 'India')}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-[11px]">
                            {candidate.phone ? (
                              <span className="text-emerald-700 font-medium">{candidate.phone}</span>
                            ) : (
                              <span className="text-[#94A3B8]">None</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-[11px]">
                            {candidate.email ? (
                              <span className="text-blue-700 font-medium">{candidate.email}</span>
                            ) : (
                              <span className="text-[#94A3B8]">None</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-[11px]">
                            {candidate.websiteUrl ? (
                              <span className="text-emerald-700 font-medium truncate max-w-[150px] inline-block" title={candidate.websiteUrl}>
                                {candidate.websiteUrl.replace(/^https?:\/\//, '')}
                              </span>
                            ) : (
                              <span className="text-rose-600 font-medium">Verified No Website</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10.5px] font-bold tracking-wide uppercase ${
                              candidate.rejectionReason === 'NO_CONTACT'
                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                : candidate.rejectionReason === 'HAS_WEBSITE'
                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                : candidate.rejectionReason === 'NO_WEBSITE'
                                ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                : candidate.rejectionReason === 'WEBSITE_UNREACHABLE'
                                ? 'bg-purple-50 text-purple-700 border border-purple-200'
                                : 'bg-slate-100 text-slate-700 border border-slate-200'
                            }`}>
                              {candidate.rejectionReason}
                            </span>
                            {candidate.rejectionDetails && (
                              <div className="text-[10px] text-[#64748B] mt-0.5 max-w-[200px] truncate" title={candidate.rejectionDetails}>
                                {candidate.rejectionDetails}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* State E: Results Table (Section 9 Columns) */}
        {hasSearched && !isSearching && leads.length > 0 && (
          <table className="w-full text-left text-[12.5px] border-collapse">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-semibold text-[#64748B] uppercase tracking-wider">
                <th className="px-3 py-3 w-8">
                  <input
                    type="checkbox"
                    checked={paginatedLeads.length > 0 && paginatedLeads.every((l) => selectedLeadIds.has(l.id))}
                    onChange={() => {
                      if (paginatedLeads.every((l) => selectedLeadIds.has(l.id))) {
                        setSelectedLeadIds(new Set());
                      } else {
                        setSelectedLeadIds(new Set(paginatedLeads.map((l) => l.id)));
                      }
                    }}
                    className="rounded border-slate-300 text-teal-600 focus:ring-teal-500 cursor-pointer"
                    title="Select / Deselect all"
                  />
                </th>
                <th className="px-5 py-3">Business</th>
                <th className="px-3 py-3">Industry</th>
                <th className="px-3 py-3">Location</th>
                <th className="px-3 py-3 w-48">Commercial Milestones</th>
                <th className="px-3 py-3">Rating &amp; Reviews</th>
                <th className="px-3 py-3">Phone</th>
                <th className="px-3 py-3">Email</th>
                <th className="px-3 py-3">Website</th>
                <th className="px-3 py-3">Website Status</th>
                <th className="px-4 py-3">Website Issues</th>
                <th className="px-3 py-3">Outreach</th>
                <th className="px-3 py-3">Source</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {paginatedLeads.map((lead) => {
                const phone = lead.contact.phone || 'Not available';
                const email = lead.contact.email || 'Not available';
                const hasPhone = phone !== 'Not available';
                const hasEmail = email !== 'Not available';
                const hasUrl = Boolean(lead.website.url && lead.website.url.trim().length > 0);
                const issues = lead.website.detectedIssues || [];

                return (
                  <tr
                    key={lead.id}
                    onClick={() => onSelectLead(lead)}
                    className="hover:bg-[#F8FAFC] transition-colors cursor-pointer group"
                  >
                    {/* Select Checkbox */}
                    <td className="px-3 py-3.5 align-top" onClick={(e) => toggleSelectLead(lead.id, e)}>
                      <input
                        type="checkbox"
                        checked={selectedLeadIds.has(lead.id)}
                        onChange={() => {}}
                        className="rounded border-slate-300 text-teal-600 focus:ring-teal-500 cursor-pointer mt-0.5"
                      />
                    </td>

                    {/* 1. Business */}
                    <td className="px-5 py-3.5 align-top">
                      <div className="flex flex-col">
                        <span className="font-semibold text-[#0F172A] group-hover:text-teal-700 transition-colors">
                          {lead.businessName}
                        </span>
                        {lead.category && (
                          <span className="text-[11px] text-[#64748B] capitalize">
                            {lead.category}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* 2. Industry */}
                    <td className="px-3 py-3.5 align-top text-[#334155] font-medium whitespace-nowrap">
                      {lead.industry}
                    </td>

                    {/* 3. Location */}
                    <td className="px-3 py-3.5 align-top text-[#475569] max-w-[170px]">
                      <div className="flex flex-col text-[11.5px]">
                        <span className="font-medium text-[#0F172A]">
                          {lead.location.city}{lead.location.state ? `, ${lead.location.state}` : ''}
                        </span>
                        {lead.location.address && lead.location.address !== 'Not available' && (
                          <span className="text-[10.5px] text-[#64748B] truncate" title={lead.location.address}>
                            {lead.location.address}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Commercial Milestones */}
                    <td className="px-3 py-3.5 align-top">
                      {lead.commercialMilestones && lead.commercialMilestones.length > 0 ? (
                        <div className="flex flex-col gap-1.5 text-[11px]">
                          {lead.commercialMilestones.map((milestone, idx) => (
                            <div key={idx} className="border-l-2 border-teal-500 pl-2">
                              <span className="font-bold text-slate-800">GMV: {milestone.gmvAmount ? (milestone.gmvCurrency === 'USD' ? '$' : '') + (milestone.gmvAmount >= 1000000 ? (milestone.gmvAmount / 1000000).toFixed(1) + 'M' : milestone.gmvAmount.toLocaleString()) : 'Verified'}</span>
                              <div className="text-slate-600 mt-0.5">{milestone.eventDate} ({milestone.dateAccuracy || 'Precision Unknown'})</div>
                              {milestone.evidence && milestone.evidence[0] && (
                                <a href={milestone.evidence[0].sourceUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="mt-0.5 text-teal-600 hover:underline inline-flex items-center truncate max-w-[120px]" title={milestone.evidence[0].evidenceText}>
                                  [{milestone.verificationStatus || 'VERIFIED'}]
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[11px] text-[#94A3B8] italic">Not publicly verified</span>
                      )}
                    </td>

                    {/* Rating & Reviews */}
                    <td className="px-3 py-3.5 align-top whitespace-nowrap">
                      {typeof lead.rating === 'number' ? (
                        <div className="flex flex-col text-[11.5px]">
                          <span className="font-bold text-[#0F172A] flex items-center gap-1">
                            <span className="text-amber-500">★</span>
                            <span>{lead.rating.toFixed(1)}</span>
                            <span className="text-[#64748B] font-normal">
                              ({lead.userRatingCount ?? lead.reviewCount ?? 0})
                            </span>
                          </span>
                          {lead.positiveReviewDataAvailable && (
                            <span className="text-[10px] text-emerald-700 font-semibold mt-0.5">
                              {typeof lead.positiveReviewRatio === 'number'
                                ? `${Math.round(lead.positiveReviewRatio * 100)}% Positive`
                                : 'Verified Reviews'}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[11px] text-[#94A3B8]">No reviews</span>
                      )}
                    </td>

                    {/* 4. Phone */}
                    <td className="px-3 py-3.5 align-top whitespace-nowrap">
                      {hasPhone ? (
                        <a
                          href={`tel:${phone}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleContactAction(lead, 'CALL_ATTEMPTED', 'phone');
                          }}
                          className="inline-flex items-center gap-1.5 text-[#0F172A] hover:text-teal-700 font-medium hover:underline cursor-pointer"
                          title={`Call ${phone} (Click to record action)`}
                        >
                          <Phone className="h-3.5 w-3.5 text-teal-600 shrink-0" />
                          <span>{phone}</span>
                        </a>
                      ) : (
                        <span className="text-[#94A3B8]">N/A</span>
                      )}
                    </td>

                    {/* 5. Email */}
                    <td className="px-3 py-3.5 align-top">
                      {hasEmail ? (
                        <a
                          href={`mailto:${email}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleContactAction(lead, 'EMAIL_SENT', 'email');
                          }}
                          className="inline-flex items-center gap-1.5 text-[#0F172A] hover:text-teal-700 font-medium hover:underline cursor-pointer"
                          title={`Email ${email} (Click to record action)`}
                        >
                          <Mail className="h-3.5 w-3.5 text-teal-600 shrink-0" />
                          <span className="truncate max-w-[140px]">{email}</span>
                        </a>
                      ) : (
                        <span className="text-[#94A3B8]">N/A</span>
                      )}
                    </td>

                    {/* 6. Website */}
                    <td className="px-3 py-3.5 align-top">
                      {hasUrl ? (
                        <a
                          href={lead.website.url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-[11.5px] text-teal-700 hover:text-teal-900 font-medium hover:underline max-w-[130px] truncate"
                          title={lead.website.url || ''}
                        >
                          <span className="truncate">{lead.website.url?.replace(/^https?:\/\//i, '').replace(/\/$/, '') || 'Website'}</span>
                          <ExternalLink className="h-3 w-3 shrink-0 opacity-70" />
                        </a>
                      ) : (
                        <span className="text-[#94A3B8]">N/A</span>
                      )}
                    </td>

                    {/* 7. Website Status */}
                    <td className="px-3 py-3.5 align-top whitespace-nowrap">
                      {renderWebsiteStatusCell(lead)}
                    </td>

                    {/* 8. Website Issues (Section 9) */}
                    <td className="px-4 py-3.5 align-top max-w-[220px]">
                      {issues.length > 0 ? (
                        <div className="space-y-0.5 text-[11px] text-[#475569]">
                          <span className="font-semibold text-amber-800 block text-[10.5px]">
                            {issues.length} {issues.length === 1 ? 'issue' : 'issues'}:
                          </span>
                          <ul className="space-y-0.5 text-[10.5px] text-[#64748B]">
                            {issues.slice(0, 2).map((iss, i) => (
                              <li key={i} className="flex items-start gap-1 leading-snug">
                                <span className="text-amber-600 font-bold">•</span>
                                <span className="truncate">{iss}</span>
                              </li>
                            ))}
                            {issues.length > 2 && (
                              <li className="text-[10px] text-teal-700 font-medium">
                                +{issues.length - 2} more issues
                              </li>
                            )}
                          </ul>
                        </div>
                      ) : lead.website.hasWebsite ? (
                        <span className="text-[11px] text-emerald-700 font-medium">
                          No issues detected
                        </span>
                      ) : (
                        <span className="text-[11px] text-[#94A3B8]">
                          —
                        </span>
                      )}
                    </td>

                    {/* 9. Outreach Status */}
                    <td className="px-3 py-3.5 align-top whitespace-nowrap">
                      {renderOutreachStatusCell(lead)}
                    </td>

                    {/* 10. Source */}
                    <td className="px-3 py-3.5 align-top whitespace-nowrap">
                      <div className="flex flex-wrap gap-1 max-w-[140px]">
                        {((lead as any).sources && (lead as any).sources.length > 0
                          ? (lead as any).sources
                          : [lead.source || 'OpenStreetMap']
                        ).map((s: string, idx: number) => {
                          const isOsm = s === 'osm' || s === 'OpenStreetMap';
                          const isWeb = s === 'web_search' || s === 'Public Web Discovery Engine';
                          const isDir = s === 'directory' || s === 'Public Business Directory Provider';
                          const label = isOsm ? 'OSM' : isWeb ? 'Web' : isDir ? 'Directory' : s;
                          const color = isOsm
                            ? 'bg-sky-50 text-sky-700 border-sky-200'
                            : isWeb
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-purple-50 text-purple-700 border-purple-200';

                          return (
                            <span
                              key={idx}
                              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${color}`}
                            >
                              {label}
                            </span>
                          );
                        })}
                      </div>
                    </td>

                    {/* 10. Actions */}
                    <td className="px-4 py-3.5 align-top text-right whitespace-nowrap">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectLead(lead);
                        }}
                        className="inline-flex items-center justify-center h-8.5 min-h-[34px] px-3.5 rounded-xl border border-[#CBD5E1] bg-white text-[12px] font-medium text-[#0F172A] hover:bg-[#0F172A] hover:text-white transition-all btn-pressable shadow-2xs cursor-pointer"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination & Attribution Footer */}
      {hasSearched && !isSearching && (
        <div className="px-5 py-3 border-t border-[#E2E8F0] bg-[#FAFBFD] flex flex-col sm:flex-row items-center justify-between gap-2 text-[12px] text-[#64748B]">
          <div className="flex items-center gap-2">
            {totalPages > 1 && (
              <span>
                Showing {startIndex + 1}–{Math.min(startIndex + pageSize, displayedLeads.length)} of {displayedLeads.length} results
              </span>
            )}
            <span className="text-[11px] text-[#94A3B8]">
              Data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="underline hover:text-[#0F172A]">OpenStreetMap contributors</a>
            </span>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-2.5 py-1 rounded-lg border border-[#CBD5E1] bg-white text-[12px] text-[#0F172A] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#F8FAFC] transition-colors cursor-pointer"
              >
                Previous
              </button>
              <span className="px-2 text-[#0F172A] font-semibold">
                {currentPage} / {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-2.5 py-1 rounded-lg border border-[#CBD5E1] bg-white text-[12px] text-[#0F172A] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#F8FAFC] transition-colors cursor-pointer"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}

      {/* Bulk AI Outreach Modal */}
      {showBulkOutreachModal && (
        <BulkAIOutreachModal
          bulkLeads={leads.filter((l) => selectedLeadIds.has(l.id))}
          onClose={() => setShowBulkOutreachModal(false)}
          onSuccess={() => {
            setSelectedLeadIds(new Set());
            if (onShowToast) {
              onShowToast('Outreach Complete', 'Selected leads outreach completed successfully.', 'success');
            }
          }}
        />
      )}
    </div>
  );
};
