'use client';

import React, { useState, useEffect } from 'react';
import { 
  Radar, 
  ExternalLink, 
  RefreshCw, 
  Sparkles, 
  Search, 
  TrendingUp, 
  AlertCircle,
  MessageSquare,
  ShieldCheck,
  Mail,
  Copy,
  Check,
  Wand2,
  Send,
  PlusCircle,
  X,
  Radio,
  FileText,
  Activity,
  Layers
} from 'lucide-react';

export interface SocialLeadItem {
  id: string;
  platform: string;
  title: string;
  selftext?: string | null;
  url: string;
  author?: string | null;
  company?: string | null;
  score: number;
  intentCategory?: string | null;
  reason?: string | null;
  enrichedEmail?: string | null;
  enrichedProvider?: string | null;
  enrichedPhone?: string | null;
  createdAt: string;
  isHistorical?: boolean;
  matchedQuery?: string;
  evidenceSnippet?: string;
  urgency?: 'HIGH' | 'MEDIUM' | 'LOW';
  recommendedAction?: string;
}

export interface SearchMetadataInfo {
  query: string;
  expandedQueries: string[];
  expansionMethod?: string;
  llmProviderUsed?: string;
  sourceStatuses: Record<string, {
    platform: string;
    displayName: string;
    status: string;
    count: number;
    error?: string | null;
    message?: string;
  }>;
  liveCount: number;
  historicalCount: number;
  emptyReason?: string;
}

export interface ConnectorHealthInfo {
  platform: string;
  displayName: string;
  status: string;
  message: string;
  isConfigured: boolean;
}

export interface CampaignOption {
  id: string;
  name: string;
  status: string;
}

export const SocialLeadsView: React.FC = () => {
  const [leads, setLeads] = useState<SocialLeadItem[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [connectorHealth, setConnectorHealth] = useState<Record<string, ConnectorHealthInfo>>({});
  const [loading, setLoading] = useState(false);
  const [enrichingId, setEnrichingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchMetadata, setSearchMetadata] = useState<SearchMetadataInfo | null>(null);
  const [searchKeyword, setSearchKeyword] = useState('looking for CRM');
  const [tableFilter, setTableFilter] = useState('');
  const [platformFilter, setPlatformFilter] = useState<'all' | 'reddit' | 'hackernews' | 'rss' | 'twitter'>('all');
  const [minScore, setMinScore] = useState<number>(0);

  // Modal State for Add to Campaign & Grounded Draft
  const [modalLead, setModalLead] = useState<SocialLeadItem | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('');
  const [draftCompany, setDraftCompany] = useState('');
  const [draftContactName, setDraftContactName] = useState('');
  const [draftContactEmail, setDraftContactEmail] = useState('');
  const [draftSubject, setDraftSubject] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [submittingCampaign, setSubmittingCampaign] = useState(false);
  const [campaignSuccessMsg, setCampaignSuccessMsg] = useState<string | null>(null);

  // Load existing leads from database
  const loadStoredLeads = async (searchTerm?: string) => {
    try {
      const url = searchTerm ? `/api/social-leads?keyword=${encodeURIComponent(searchTerm)}` : '/api/social-leads';
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && Array.isArray(data.leads)) {
        setLeads(data.leads);
        setError(null);
      }
    } catch {
      // Keep existing state
    }
  };

  // Load active campaigns for enrollment
  const loadCampaigns = async () => {
    try {
      const res = await fetch('/api/campaigns', { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && Array.isArray(data.campaigns)) {
        setCampaigns(data.campaigns);
        if (data.campaigns.length > 0 && !selectedCampaignId) {
          setSelectedCampaignId(data.campaigns[0].id);
        }
      }
    } catch {
      // Fallback
    }
  };

  // Load connector health diagnostics (Agent Reach pattern)
  const loadConnectorHealth = async () => {
    try {
      const res = await fetch('/api/social-leads/connectors', { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && data.connectors) {
        setConnectorHealth(data.connectors);
      }
    } catch {
      // Keep state
    }
  };

  useEffect(() => {
    loadStoredLeads();
    loadCampaigns();
    loadConnectorHealth();
  }, []);

  // Trigger Real Multi-Source Search and Intent Scoring via /api/scrape
  const handleSearchIntent = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const query = searchKeyword.trim();
    if (!query) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: query }),
        signal: AbortSignal.timeout(20000),
      });

      const data = await res.json();

      if (data.success && Array.isArray(data.leads)) {
        setLeads(data.leads);
        setSearchMetadata({
          query: data.keyword || query,
          expandedQueries: data.expandedQueries || [],
          expansionMethod: data.expansionMethod,
          llmProviderUsed: data.llmProviderUsed,
          sourceStatuses: data.sourceStatuses || {},
          liveCount: data.liveCount ?? data.leads.filter((l: any) => !l.isHistorical).length,
          historicalCount: data.historicalCount ?? data.leads.filter((l: any) => l.isHistorical).length,
          emptyReason: data.emptyReason,
        });
        setError(null);
      } else {
        setError(data.error || 'Failed to search and score social leads.');
      }
    } catch (err: any) {
      setError(err.message || 'Search request timed out or network error.');
    } finally {
      setLoading(false);
    }
  };

  // Manual Magic Wand Enrichment
  const handleEnrichLead = async (lead: SocialLeadItem) => {
    setEnrichingId(lead.id);
    try {
      const res = await fetch('/api/social-leads/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: lead.id,
          author: lead.author,
          company: lead.company,
        }),
      });
      const data = await res.json();
      if (data.success && data.enrichedEmail) {
        setLeads((prev) =>
          prev.map((item) =>
            item.id === lead.id
              ? {
                  ...item,
                  enrichedEmail: data.enrichedEmail,
                  enrichedPhone: data.enrichedPhone || item.enrichedPhone,
                }
              : item
          )
        );
      } else {
        alert(data.error || `No verified email found for ${lead.author || 'this contact'}.`);
      }
    } catch (err: any) {
      alert(`Enrichment failed: ${err.message || err}`);
    } finally {
      setEnrichingId(null);
    }
  };

  const handleCopyEmail = (email: string, id: string) => {
    navigator.clipboard.writeText(email);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Open Modal to Add Lead to Campaign & Draft Grounded Outreach
  const handleOpenCampaignModal = (lead: SocialLeadItem) => {
    setModalLead(lead);
    setCampaignSuccessMsg(null);
    setDraftCompany(lead.company || lead.author || 'Prospective Lead');
    setDraftContactName(lead.author || '');
    setDraftContactEmail(lead.enrichedEmail || '');

    // Generate grounded draft default
    const platformLabel = lead.platform === 'twitter' ? 'on X' : lead.platform === 'reddit' ? 'on Reddit' : 'online';
    const cleanSnippet = (lead.selftext || lead.title).slice(0, 110);
    setDraftSubject(`Regarding your recent note ${platformLabel} on software requirements`);
    setDraftBody(`Hi ${lead.author ? lead.author.split(' ')[0] : 'there'},

I saw your post ${platformLabel} discussing: "${cleanSnippet}...".

We help teams solve this exact requirement with automated lead intelligence and verified data workflows.

Would you be open to a brief look at how we solve this, or should I follow up later?

Best regards,
LeadPilot Team`);
  };

  const handleEnrollInCampaign = async () => {
    if (!modalLead || !selectedCampaignId) {
      alert('Please select a campaign.');
      return;
    }

    setSubmittingCampaign(true);
    setCampaignSuccessMsg(null);

    try {
      const res = await fetch('/api/social-leads/convert-to-campaign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          socialLeadId: modalLead.id,
          campaignId: selectedCampaignId,
          companyName: draftCompany,
          contactName: draftContactName,
          contactEmail: draftContactEmail,
          customDraftSubject: draftSubject,
          customDraftBody: draftBody,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setCampaignSuccessMsg('Lead successfully enrolled into campaign! Outreach draft saved awaiting human review.');
        setTimeout(() => {
          setModalLead(null);
          setCampaignSuccessMsg(null);
        }, 2200);
      } else {
        alert(data.error || 'Failed to enroll lead into campaign.');
      }
    } catch (err: any) {
      alert(`Error enrolling lead: ${err.message}`);
    } finally {
      setSubmittingCampaign(false);
    }
  };

  // Filter leads based on table search & platform filters
  const filteredLeads = leads.filter((item) => {
    if (platformFilter !== 'all' && item.platform.toLowerCase() !== platformFilter) {
      return false;
    }
    if (item.score < minScore) {
      return false;
    }
    if (tableFilter.trim()) {
      const q = tableFilter.toLowerCase();
      const inTitle = item.title.toLowerCase().includes(q);
      const inText = (item.selftext || '').toLowerCase().includes(q);
      const inAuthor = (item.author || '').toLowerCase().includes(q);
      const inReason = (item.reason || '').toLowerCase().includes(q);
      if (!inTitle && !inText && !inAuthor && !inReason) return false;
    }
    return true;
  });

  const highIntentCount = leads.filter((l) => l.score >= 80).length;
  const avgScore = leads.length > 0 
    ? Math.round(leads.reduce((acc, curr) => acc + curr.score, 0) / leads.length) 
    : 0;

  return (
    <div className="space-y-6 animate-fade-in max-w-[1400px] w-full mx-auto pb-12">
      {/* Connector Health Diagnostics Bar (Agent Reach Pattern) */}
      <div className="bg-white px-5 py-3.5 rounded-2xl border border-[#E2E8F0] shadow-2xs flex flex-wrap items-center justify-between gap-3 text-[12px]">
        <div className="flex items-center gap-2 font-semibold text-[#0F172A]">
          <Activity className="h-4 w-4 text-teal-600" />
          <span>Connector Diagnostics:</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {Object.entries(connectorHealth).map(([key, info]) => {
            const isReady = info.status === 'READY';
            const isNotConfig = info.status === 'NOT_CONFIGURED';
            return (
              <div 
                key={key} 
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border ${
                  isReady 
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
                    : isNotConfig
                    ? 'bg-amber-50 text-amber-800 border-amber-200'
                    : 'bg-rose-50 text-rose-800 border-rose-200'
                }`}
                title={info.message}
              >
                <span className={`h-2 w-2 rounded-full ${isReady ? 'bg-emerald-500 animate-pulse' : isNotConfig ? 'bg-amber-500' : 'bg-rose-500'}`} />
                <span className="font-medium capitalize">{info.displayName || key}:</span>
                <span className="font-mono text-[11px] uppercase tracking-wider">{info.status}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Top Header & Search Bar Card */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5 bg-white p-6 rounded-2xl border border-[#E2E8F0] shadow-xs">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-600 border border-teal-200/60 shadow-2xs">
              <Radar className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-[20px] font-bold text-[#0F172A] tracking-tight">
                  B2B Buying-Intent Signals
                </h1>
                <span className="px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
                  SignalPipe + Agent Reach
                </span>
              </div>
              <p className="text-[13px] text-[#64748B]">
                Real-time buying intent across Reddit, Hacker News, RSS & X scored with 3-Judge LLM Panel
              </p>
            </div>
          </div>
        </div>

        {/* Primary Search Form */}
        <form onSubmit={handleSearchIntent} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <div className="relative flex-1 sm:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#94A3B8]" />
            <input
              type="text"
              placeholder="Search Intent (e.g., looking for CRM)"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              className="w-full pl-9 pr-3.5 py-2.5 text-[13px] bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-[#0F172A] placeholder-[#94A3B8] focus:outline-none focus:ring-1 focus:ring-teal-500 focus:bg-white transition-all shadow-2xs"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-[13px] font-semibold rounded-xl bg-[#0F172A] text-white hover:bg-slate-800 transition-all shadow-xs cursor-pointer disabled:opacity-60 whitespace-nowrap"
          >
            {loading ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin text-teal-400" />
                Scoring Signals...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 text-teal-300" />
                Detect Intent
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => loadStoredLeads()}
            disabled={loading}
            className="inline-flex items-center justify-center p-2.5 text-[13px] font-medium rounded-xl border border-[#E2E8F0] bg-white text-[#475569] hover:bg-[#F8FAFC] hover:text-[#0F172A] transition-colors shadow-2xs cursor-pointer disabled:opacity-60"
            title="Refresh database"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </form>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-[#E2E8F0] shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium uppercase tracking-wider text-[#64748B]">
              Total Ingested Signals
            </span>
            <span className="p-1.5 rounded-lg bg-slate-50 text-slate-500">
              <MessageSquare className="h-4 w-4" />
            </span>
          </div>
          <p className="text-[24px] font-bold text-[#0F172A] mt-2">
            {leads.length}
          </p>
          <p className="text-[11.5px] text-[#64748B] mt-0.5">
            Deduplicated records in database
          </p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-[#E2E8F0] shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium uppercase tracking-wider text-[#64748B]">
              High-Intent Leads (≥ 80)
            </span>
            <span className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600">
              <TrendingUp className="h-4 w-4" />
            </span>
          </div>
          <p className="text-[24px] font-bold text-emerald-600 mt-2">
            {highIntentCount}
          </p>
          <p className="text-[11.5px] text-[#64748B] mt-0.5">
            Verified buying & competitor-switching signals
          </p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-[#E2E8F0] shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium uppercase tracking-wider text-[#64748B]">
              Average Confidence
            </span>
            <span className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600">
              <ShieldCheck className="h-4 w-4" />
            </span>
          </div>
          <p className="text-[24px] font-bold text-[#0F172A] mt-2">
            {avgScore}<span className="text-[14px] text-[#64748B] font-normal">/100</span>
          </p>
          <p className="text-[11.5px] text-[#64748B] mt-0.5">
            Evaluated by Groq / OpenRouter AI
          </p>
        </div>
      </div>

      {/* Active Search Expansion & Diagnostic Bar */}
      {searchMetadata && (
        <div className="bg-gradient-to-r from-teal-50/70 via-slate-50 to-indigo-50/60 p-4 rounded-2xl border border-teal-200/60 shadow-2xs space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-teal-500 animate-pulse" />
              <span className="text-[13px] font-semibold text-[#0F172A]">
                Search: <span className="text-teal-700">"{searchMetadata.query}"</span>
              </span>
              <span className="text-[11.5px] text-[#64748B]">
                ({searchMetadata.liveCount} live, {searchMetadata.historicalCount} historical)
              </span>
              {searchMetadata.expansionMethod && (
                <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded bg-teal-100 text-teal-800">
                  {searchMetadata.expansionMethod === 'LLM_EXPANSION' ? `AI Expanded (${searchMetadata.llmProviderUsed || 'LLM'})` : 'Rules Expanded'}
                </span>
              )}
            </div>

            {/* Clear search / view all */}
            <button
              onClick={() => {
                setSearchMetadata(null);
                loadStoredLeads();
              }}
              className="text-[11.5px] font-medium text-slate-500 hover:text-slate-900 transition-colors cursor-pointer"
            >
              Reset to all leads
            </button>
          </div>

          {/* Expanded Variants Pills */}
          {searchMetadata.expandedQueries.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="text-[#64748B] font-medium">Variants Searched:</span>
              <span className="px-2 py-0.5 rounded-md bg-white border border-teal-200 text-teal-800 font-medium">
                "{searchMetadata.query}"
              </span>
              {searchMetadata.expandedQueries.map((variant, i) => (
                <span key={i} className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-[#475569]">
                  "{variant}"
                </span>
              ))}
            </div>
          )}

          {/* Per-Source Diagnostic Chips */}
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-200/50 text-[11px]">
            <span className="text-[#64748B] font-medium">Provider Results:</span>
            {Object.entries(searchMetadata.sourceStatuses).map(([key, info]) => {
              const isSuccess = info.status === 'SUCCESS';
              const isRateLimit = info.status === 'RATE_LIMITED';
              const isNotConfig = info.status === 'NOT_CONFIGURED';
              return (
                <div
                  key={key}
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border ${
                    isSuccess && info.count > 0
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : isSuccess
                      ? 'bg-slate-50 text-slate-600 border-slate-200'
                      : isRateLimit
                      ? 'bg-amber-50 text-amber-800 border-amber-200'
                      : isNotConfig
                      ? 'bg-slate-100 text-slate-600 border-slate-200'
                      : 'bg-rose-50 text-rose-800 border-rose-200'
                  }`}
                  title={info.error || info.message || `${info.count} results`}
                >
                  <span className="font-semibold capitalize">{info.displayName?.split(' ')[0] || key}:</span>
                  <span>{info.count > 0 ? `${info.count} signals` : info.status}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filter and Table Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-[#E2E8F0] shadow-2xs">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#94A3B8]" />
          <input
            type="text"
            placeholder="Filter by keyword, post, or handle..."
            value={tableFilter}
            onChange={(e) => setTableFilter(e.target.value)}
            className="w-full pl-9 pr-3.5 py-1.5 text-[13px] bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-[#0F172A] placeholder-[#94A3B8] focus:outline-none focus:ring-1 focus:ring-teal-500 focus:bg-white transition-all"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Platform Filter */}
          <div className="flex items-center bg-[#F1F5F9] p-1 rounded-xl">
            {(['all', 'hackernews', 'reddit', 'rss', 'twitter'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPlatformFilter(p)}
                className={`px-3 py-1 text-[12px] font-medium rounded-lg transition-colors cursor-pointer capitalize ${
                  platformFilter === p
                    ? 'bg-white text-[#0F172A] shadow-xs'
                    : 'text-[#64748B] hover:text-[#0F172A]'
                }`}
              >
                {p === 'all' ? 'All Sources' : p === 'hackernews' ? 'Hacker News' : p === 'twitter' ? 'X / Twitter' : p}
              </button>
            ))}
          </div>

          {/* Min Score Filter */}
          <select
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            className="px-3 py-1.5 text-[12px] font-medium bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-[#475569] focus:outline-none cursor-pointer"
          >
            <option value={0}>All Scores</option>
            <option value={70}>Score ≥ 70</option>
            <option value={80}>Score ≥ 80 (High Intent)</option>
            <option value={90}>Score ≥ 90 (Urgent Buyer)</option>
          </select>
        </div>
      </div>

      {/* Main Results Table */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-xs overflow-hidden">
        {loading ? (
          <div className="py-24 flex flex-col items-center justify-center text-center">
            <RefreshCw className="h-8 w-8 text-teal-600 animate-spin mb-3" />
            <p className="text-[15px] font-semibold text-[#0F172A]">Classifying Signals with SignalPipe Panel...</p>
            <p className="text-[13px] text-[#64748B] max-w-sm mt-1">
              Evaluating purchase intent across Hacker News, RSS, Reddit and X without self-promotion.
            </p>
          </div>
        ) : error ? (
          <div className="py-16 flex flex-col items-center justify-center text-center px-4 max-w-md mx-auto">
            <AlertCircle className="h-8 w-8 text-rose-500 mb-2" />
            <p className="text-[14px] font-medium text-rose-600">{error}</p>
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => handleSearchIntent()}
                className="px-3.5 py-1.5 text-[12px] font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Retry Search
              </button>
              <button
                onClick={() => loadStoredLeads()}
                className="px-3.5 py-1.5 text-[12px] font-medium rounded-lg bg-slate-100 text-[#0F172A] hover:bg-slate-200 transition-colors cursor-pointer"
              >
                Load Stored Leads
              </button>
            </div>
          </div>
        ) : filteredLeads.length === 0 ? (
          <div className="py-16 flex flex-col items-center justify-center text-center px-6 max-w-2xl mx-auto space-y-4">
            <div className="h-12 w-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400">
              <Radar className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-[16px] font-bold text-[#0F172A]">
                {searchMetadata ? `No signals found matching "${searchMetadata.query}"` : 'No buying-intent signals found'}
              </h3>
              <p className="text-[13px] text-[#64748B] mt-1.5 leading-relaxed">
                {searchMetadata?.emptyReason ||
                  'Enter a commercial or procurement topic like "spare parts", "replacement parts", or "looking for CRM" to discover active buyers.'}
              </p>
            </div>

            {/* Diagnostic Details */}
            {searchMetadata && searchMetadata.expandedQueries.length > 0 && (
              <div className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-3 text-left space-y-2">
                <span className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block">
                  Expanded Variants Searched:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <span className="px-2 py-0.5 text-[11px] font-medium rounded-md bg-teal-50 text-teal-700 border border-teal-200">
                    "{searchMetadata.query}" (Original)
                  </span>
                  {searchMetadata.expandedQueries.map((variant, i) => (
                    <span key={i} className="px-2 py-0.5 text-[11px] font-medium rounded-md bg-white text-[#334155] border border-slate-200">
                      "{variant}"
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Suggestions & Action */}
            <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
              <button
                onClick={() => handleSearchIntent()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-[12.5px] font-semibold rounded-xl bg-[#0F172A] text-white hover:bg-slate-800 transition-colors shadow-2xs cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5 text-teal-400" />
                <span>Retry Search</span>
              </button>
              <button
                onClick={() => {
                  setSearchKeyword('replacement parts');
                  setTableFilter('');
                }}
                className="px-3 py-2 text-[12.5px] font-medium rounded-xl border border-[#E2E8F0] bg-white text-[#475569] hover:bg-[#F8FAFC] transition-colors cursor-pointer"
              >
                Try "replacement parts"
              </button>
              <button
                onClick={() => loadStoredLeads()}
                className="px-3 py-2 text-[12.5px] font-medium rounded-xl border border-[#E2E8F0] bg-white text-[#475569] hover:bg-[#F8FAFC] transition-colors cursor-pointer"
              >
                View All Stored Leads
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
                  <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider text-[#64748B] w-32">
                    Source & Provenance
                  </th>
                  <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
                    Post Content & Provenance
                  </th>
                  <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider text-[#64748B] w-36">
                    Author
                  </th>
                  <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider text-[#64748B] w-32">
                    Intent Score
                  </th>
                  <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider text-[#64748B] w-72">
                    Evidence & Reasons
                  </th>
                  <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider text-[#64748B] w-64">
                    Action & Outreach
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9] text-[13px]">
                {filteredLeads.map((item) => {
                  const isHighIntent = item.score >= 80;
                  const platformKey = item.platform.toLowerCase();
                  const isReddit = platformKey === 'reddit';
                  const isHN = platformKey === 'hackernews';
                  const isX = platformKey === 'twitter';
                  const isEnriching = enrichingId === item.id;
                  const isCopied = copiedId === item.id;
                  const isLive = !item.isHistorical;

                  return (
                    <tr 
                      key={item.id}
                      className="hover:bg-[#F8FAFC]/80 transition-colors group"
                    >
                      {/* 1. Platform & Provenance */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex flex-col gap-1 items-start">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-full border ${
                              isReddit
                                ? 'bg-orange-50 text-orange-700 border-orange-200'
                                : isHN
                                ? 'bg-amber-50 text-amber-800 border-amber-200'
                                : isX
                                ? 'bg-sky-50 text-sky-800 border-sky-200'
                                : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            }`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                isReddit ? 'bg-orange-500' : isHN ? 'bg-amber-600' : isX ? 'bg-sky-500' : 'bg-emerald-600'
                              }`}
                            />
                            {isReddit ? 'Reddit' : isHN ? 'Hacker News' : isX ? 'X' : 'RSS Feed'}
                          </span>

                          <span
                            className={`text-[9.5px] font-semibold uppercase px-1.5 py-0.5 rounded ${
                              isLive
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-200/60'
                                : 'bg-slate-100 text-slate-600 border border-slate-200'
                            }`}
                          >
                            {isLive ? 'LIVE' : 'HISTORICAL'}
                          </span>
                        </div>
                      </td>

                      {/* 2. Post Text & Title with Link */}
                      <td className="py-3.5 px-4 max-w-sm md:max-w-md">
                        <div className="space-y-1">
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-[#0F172A] hover:text-teal-600 transition-colors inline-flex items-center gap-1.5 group-hover:underline truncate max-w-full"
                            title={item.title}
                          >
                            <span className="truncate">{item.title}</span>
                            <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[#94A3B8] group-hover:text-teal-600" />
                          </a>

                          {item.selftext && item.selftext !== item.title && (
                            <p className="text-[12px] text-[#64748B] line-clamp-2 leading-relaxed">
                              {item.selftext}
                            </p>
                          )}

                          {item.matchedQuery && (
                            <div className="pt-0.5">
                              <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-teal-800 bg-teal-50 px-1.5 py-0.5 rounded border border-teal-200">
                                Matched: "{item.matchedQuery}"
                              </span>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* 3. Author */}
                      <td className="py-3.5 px-4 whitespace-nowrap text-[#0F172A]">
                        <span className="font-mono text-[12px] bg-slate-50 px-2 py-0.5 rounded border border-slate-200/60">
                          {item.author || 'Anonymous'}
                        </span>
                      </td>

                      {/* 4. Intent Score */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex flex-col gap-1 items-start">
                          <span
                            className={`inline-flex items-center justify-center min-w-[48px] px-2.5 py-1 text-[12px] font-bold rounded-lg border ${
                              isHighIntent
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-300/80 shadow-2xs'
                                : item.score >= 70
                                ? 'bg-teal-50 text-teal-700 border-teal-200'
                                : 'bg-amber-50 text-amber-700 border-amber-200'
                            }`}
                          >
                            {item.score}
                          </span>
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border capitalize ${
                            item.intentCategory?.includes('complaint') 
                              ? 'bg-rose-50 text-rose-700 border-rose-200' 
                              : item.intentCategory?.includes('switch')
                              ? 'bg-purple-50 text-purple-700 border-purple-200'
                              : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                          }`}>
                            {item.intentCategory ? item.intentCategory.replace(/_/g, ' ') : 'buy intent'}
                          </span>
                        </div>
                      </td>

                      {/* 5. Reason & Evidence */}
                      <td className="py-3.5 px-4 text-[#475569] text-[12.5px] leading-relaxed">
                        <div className="space-y-1">
                          <span className="line-clamp-2">
                            {item.reason || 'AI scored intent based on purchase signals.'}
                          </span>
                          {item.evidenceSnippet && (
                            <p className="text-[11px] font-mono text-[#64748B] italic bg-slate-50 p-1 rounded border border-slate-200/60 line-clamp-1">
                              &ldquo;{item.evidenceSnippet}&rdquo;
                            </p>
                          )}
                        </div>
                      </td>

                      {/* 6. Action / Campaign Enrollment / Email */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex flex-col gap-2">
                          {item.enrichedEmail ? (
                            <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200/80 rounded-xl px-2.5 py-1 text-emerald-800 shadow-2xs">
                              <Mail className="h-3 w-3 text-emerald-600 shrink-0" />
                              <span className="text-[11px] font-mono font-medium truncate max-w-[120px]" title={item.enrichedEmail}>
                                {item.enrichedEmail}
                              </span>
                              <button
                                onClick={() => handleCopyEmail(item.enrichedEmail!, item.id)}
                                className="p-0.5 hover:bg-emerald-100 rounded text-emerald-700 cursor-pointer ml-auto"
                                title="Copy email"
                              >
                                {isCopied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => handleEnrichLead(item)}
                              disabled={isEnriching}
                              className="inline-flex items-center justify-center gap-1.5 px-2 py-1 text-[11px] font-medium rounded-lg border border-teal-200 bg-teal-50/60 text-teal-700 hover:bg-teal-100 cursor-pointer transition-all disabled:opacity-50"
                            >
                              <Wand2 className={`h-3 w-3 ${isEnriching ? 'animate-spin' : ''}`} />
                              <span>{isEnriching ? 'Enriching...' : 'Waterfall Enrich'}</span>
                            </button>
                          )}

                          <button
                            onClick={() => handleOpenCampaignModal(item)}
                            className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11.5px] font-semibold rounded-xl bg-slate-900 text-white hover:bg-teal-700 transition-colors shadow-2xs cursor-pointer"
                          >
                            <PlusCircle className="h-3.5 w-3.5 text-teal-400" />
                            <span>Add to Campaign</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Grounded Outreach & Add to Campaign Modal */}
      {modalLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-fade-in">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-teal-600" />
                <h3 className="text-[17px] font-bold text-[#0F172A]">Contextual Outreach Draft</h3>
              </div>
              <button 
                onClick={() => setModalLead(null)}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-500 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {campaignSuccessMsg ? (
              <div className="py-8 flex flex-col items-center justify-center text-center space-y-2">
                <div className="h-10 w-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <Check className="h-6 w-6" />
                </div>
                <p className="text-[14px] font-semibold text-emerald-800">{campaignSuccessMsg}</p>
                <p className="text-[12px] text-slate-500">Draft saved in Campaign Leads under status PENDING_APPROVAL.</p>
              </div>
            ) : (
              <>
                {/* Original Signal Evidence Banner */}
                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200/80 text-[12px] space-y-1">
                  <div className="flex items-center justify-between font-semibold text-slate-700">
                    <span className="uppercase tracking-wider text-[11px] text-slate-500">Grounded Signal Evidence</span>
                    <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold">Score: {modalLead.score}/100</span>
                  </div>
                  <p className="text-slate-800 font-medium italic line-clamp-2">&quot;{modalLead.title}&quot;</p>
                  <p className="text-[11px] text-slate-500">Source: {modalLead.platform} • Author: {modalLead.author || 'Anonymous'}</p>
                </div>

                {/* Target Campaign Select */}
                <div>
                  <label className="block text-[12px] font-semibold text-slate-700 mb-1">Target Campaign</label>
                  {campaigns.length > 0 ? (
                    <select
                      value={selectedCampaignId}
                      onChange={(e) => setSelectedCampaignId(e.target.value)}
                      className="w-full px-3 py-2 text-[13px] bg-white border border-slate-200 rounded-xl focus:ring-1 focus:ring-teal-500"
                    >
                      {campaigns.map((c) => (
                        <option key={c.id} value={c.id}>{c.name} ({c.status})</option>
                      ))}
                    </select>
                  ) : (
                    <div className="text-[12px] text-amber-700 bg-amber-50 p-2.5 rounded-xl border border-amber-200">
                      No campaigns found. Please create a campaign in Campaigns tab first.
                    </div>
                  )}
                </div>

                {/* Target Company & Contact */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[12px] font-semibold text-slate-700 mb-1">Company / Entity</label>
                    <input
                      type="text"
                      value={draftCompany}
                      onChange={(e) => setDraftCompany(e.target.value)}
                      className="w-full px-3 py-2 text-[13px] border border-slate-200 rounded-xl"
                      placeholder="Company Name"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-semibold text-slate-700 mb-1">Recipient Email</label>
                    <input
                      type="email"
                      value={draftContactEmail}
                      onChange={(e) => setDraftContactEmail(e.target.value)}
                      className="w-full px-3 py-2 text-[13px] border border-slate-200 rounded-xl"
                      placeholder="contact@company.com"
                    />
                  </div>
                </div>

                {/* Subject Line */}
                <div>
                  <label className="block text-[12px] font-semibold text-slate-700 mb-1">Outreach Subject</label>
                  <input
                    type="text"
                    value={draftSubject}
                    onChange={(e) => setDraftSubject(e.target.value)}
                    className="w-full px-3 py-2 text-[13px] border border-slate-200 rounded-xl"
                  />
                </div>

                {/* Grounded Body */}
                <div>
                  <label className="block text-[12px] font-semibold text-slate-700 mb-1">Grounded Message Body</label>
                  <textarea
                    rows={6}
                    value={draftBody}
                    onChange={(e) => setDraftBody(e.target.value)}
                    className="w-full px-3 py-2 text-[12.5px] font-sans border border-slate-200 rounded-xl leading-relaxed"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Grounded strictly in the prospect's public post. Human approval is strictly required before sending.
                  </p>
                </div>

                {/* Modal Footer Actions */}
                <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setModalLead(null)}
                    className="px-4 py-2 text-[12.5px] font-medium text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={submittingCampaign || !selectedCampaignId}
                    onClick={handleEnrollInCampaign}
                    className="inline-flex items-center gap-1.5 px-5 py-2 text-[12.5px] font-semibold rounded-xl bg-teal-600 text-white hover:bg-teal-700 transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
                  >
                    {submittingCampaign ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        Saving & Enrolling...
                      </>
                    ) : (
                      <>
                        <Check className="h-4 w-4" />
                        Save Draft & Enroll (Pending Approval)
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
