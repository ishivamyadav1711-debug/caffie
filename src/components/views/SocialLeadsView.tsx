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
}

export const SocialLeadsView: React.FC = () => {
  const [leads, setLeads] = useState<SocialLeadItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [enrichingId, setEnrichingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchKeyword, setSearchKeyword] = useState('looking for CRM');
  const [tableFilter, setTableFilter] = useState('');
  const [platformFilter, setPlatformFilter] = useState<'all' | 'reddit' | 'hackernews'>('all');
  const [minScore, setMinScore] = useState<number>(0);

  // Load existing leads from database
  const loadStoredLeads = async () => {
    try {
      const res = await fetch('/api/social-leads', { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && Array.isArray(data.leads)) {
        setLeads(data.leads);
      }
    } catch {
      // Keep existing state
    }
  };

  useEffect(() => {
    loadStoredLeads();
  }, []);

  // Trigger Real Scrape (Hacker News + Reddit) and AI Intent Scoring via /api/scrape
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
        signal: AbortSignal.timeout(15000),
      });

      const data = await res.json();

      if (data.success && Array.isArray(data.leads)) {
        setLeads(data.leads);
      } else {
        setError(data.error || 'Failed to scrape and score social leads.');
      }
    } catch (err: any) {
      setError(err.message || 'Scrape request timed out or network error.');
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
                  High-Intent Social Leads
                </h1>
                <span className="px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
                  Live AI Scraper
                </span>
              </div>
              <p className="text-[13px] text-[#64748B]">
                Real-time keyword listening across Hacker News & Reddit scored with Groq & OpenRouter
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
                Scraping & Scoring...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 text-teal-300" />
                Search Intent
              </>
            )}
          </button>

          <button
            type="button"
            onClick={loadStoredLeads}
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
              Total Ingested
            </span>
            <span className="p-1.5 rounded-lg bg-slate-50 text-slate-500">
              <MessageSquare className="h-4 w-4" />
            </span>
          </div>
          <p className="text-[24px] font-bold text-[#0F172A] mt-2">
            {leads.length}
          </p>
          <p className="text-[11.5px] text-[#64748B] mt-0.5">
            Real posts in database
          </p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-[#E2E8F0] shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium uppercase tracking-wider text-[#64748B]">
              High Intent (≥ 80)
            </span>
            <span className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600">
              <TrendingUp className="h-4 w-4" />
            </span>
          </div>
          <p className="text-[24px] font-bold text-emerald-600 mt-2">
            {highIntentCount}
          </p>
          <p className="text-[11.5px] text-[#64748B] mt-0.5">
            Strong buying or replacement signals
          </p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-[#E2E8F0] shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium uppercase tracking-wider text-[#64748B]">
              Average AI Score
            </span>
            <span className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600">
              <ShieldCheck className="h-4 w-4" />
            </span>
          </div>
          <p className="text-[24px] font-bold text-[#0F172A] mt-2">
            {avgScore}<span className="text-[14px] text-[#64748B] font-normal">/100</span>
          </p>
          <p className="text-[11.5px] text-[#64748B] mt-0.5">
            Evaluated by Groq / OpenRouter
          </p>
        </div>
      </div>

      {/* Filter and Table Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-[#E2E8F0] shadow-2xs">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#94A3B8]" />
          <input
            type="text"
            placeholder="Filter results by keyword or author..."
            value={tableFilter}
            onChange={(e) => setTableFilter(e.target.value)}
            className="w-full pl-9 pr-3.5 py-1.5 text-[13px] bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-[#0F172A] placeholder-[#94A3B8] focus:outline-none focus:ring-1 focus:ring-teal-500 focus:bg-white transition-all"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Platform Filter */}
          <div className="flex items-center bg-[#F1F5F9] p-1 rounded-xl">
            {(['all', 'hackernews', 'reddit'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPlatformFilter(p)}
                className={`px-3 py-1 text-[12px] font-medium rounded-lg transition-colors cursor-pointer capitalize ${
                  platformFilter === p
                    ? 'bg-white text-[#0F172A] shadow-xs'
                    : 'text-[#64748B] hover:text-[#0F172A]'
                }`}
              >
                {p === 'all' ? 'All Platforms' : p === 'hackernews' ? 'Hacker News' : 'Reddit'}
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
            <p className="text-[15px] font-semibold text-[#0F172A]">Fetching Real Posts & AI Scoring...</p>
            <p className="text-[13px] text-[#64748B] max-w-sm mt-1">
              Pulling discussions from Hacker News & Reddit and scoring purchasing intent with Groq / OpenRouter.
            </p>
          </div>
        ) : error ? (
          <div className="py-16 flex flex-col items-center justify-center text-center px-4">
            <AlertCircle className="h-8 w-8 text-rose-500 mb-2" />
            <p className="text-[14px] font-medium text-rose-600">{error}</p>
            <button
              onClick={() => handleSearchIntent()}
              className="mt-3 px-3.5 py-1.5 text-[12px] font-medium rounded-lg bg-slate-100 text-[#0F172A] hover:bg-slate-200 transition-colors cursor-pointer"
            >
              Retry
            </button>
          </div>
        ) : filteredLeads.length === 0 ? (
          <div className="py-20 flex flex-col items-center justify-center text-center px-4">
            <div className="h-12 w-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mb-3">
              <Radar className="h-6 w-6" />
            </div>
            <h3 className="text-[15px] font-semibold text-[#0F172A]">No social leads found</h3>
            <p className="text-[13px] text-[#64748B] max-w-sm mt-1">
              Enter a search query like &quot;looking for CRM&quot; above and click &quot;Search Intent&quot; to fetch live posts.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
                  <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider text-[#64748B] w-28">
                    Platform
                  </th>
                  <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
                    Post Text / Content
                  </th>
                  <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider text-[#64748B] w-36">
                    Author
                  </th>
                  <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider text-[#64748B] w-32">
                    Intent Score
                  </th>
                  <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider text-[#64748B] w-72">
                    Reason
                  </th>
                  <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-wider text-[#64748B] w-56">
                    Contact Info
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9] text-[13px]">
                {filteredLeads.map((item) => {
                  const isHighIntent = item.score >= 80;
                  const platformKey = item.platform.toLowerCase();
                  const isReddit = platformKey === 'reddit';
                  const isEnriching = enrichingId === item.id;
                  const isCopied = copiedId === item.id;

                  return (
                    <tr 
                      key={item.id}
                      className="hover:bg-[#F8FAFC]/80 transition-colors group"
                    >
                      {/* 1. Platform */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-full border ${
                            isReddit
                              ? 'bg-orange-50 text-orange-700 border-orange-200'
                              : 'bg-amber-50 text-amber-800 border-amber-200'
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              isReddit ? 'bg-orange-500' : 'bg-amber-600'
                            }`}
                          />
                          {isReddit ? 'Reddit' : 'Hacker News'}
                        </span>
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
                            item.intentCategory === 'complaint' 
                              ? 'bg-rose-50 text-rose-700 border-rose-200' 
                              : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                          }`}>
                            {item.intentCategory ? item.intentCategory.replace('_', ' ') : 'buy intent'}
                          </span>
                        </div>
                      </td>

                      {/* 5. Reason */}
                      <td className="py-3.5 px-4 text-[#475569] text-[12.5px] leading-relaxed">
                        <span className="line-clamp-2">
                          {item.reason || 'AI scored intent based on purchase signals.'}
                        </span>
                      </td>

                      {/* 6. Contact Info / Email & Magic Wand */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {item.enrichedEmail ? (
                          <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200/80 rounded-xl px-2.5 py-1.5 text-emerald-800 shadow-2xs">
                            <Mail className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                            <span className="text-[12px] font-mono font-medium truncate max-w-[130px]" title={item.enrichedEmail}>
                              {item.enrichedEmail}
                            </span>
                            <div className="flex items-center gap-1 ml-auto shrink-0">
                              <button
                                onClick={() => handleCopyEmail(item.enrichedEmail!, item.id)}
                                className="p-1 hover:bg-emerald-100 rounded text-emerald-700 transition-colors cursor-pointer"
                                title="Copy email"
                              >
                                {isCopied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                              </button>
                              <a
                                href={`mailto:${item.enrichedEmail}?subject=Regarding your recent post: ${encodeURIComponent(item.title)}`}
                                className="p-1 hover:bg-emerald-100 rounded text-emerald-700 transition-colors cursor-pointer"
                                title="Send email"
                              >
                                <Send className="h-3.5 w-3.5 text-emerald-600" />
                              </a>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            {isHighIntent && (
                              <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium text-slate-500 bg-slate-100 rounded-md border border-slate-200">
                                Email Not Found
                              </span>
                            )}
                            <button
                              onClick={() => handleEnrichLead(item)}
                              disabled={isEnriching}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11.5px] font-medium rounded-xl border border-teal-200 bg-teal-50/60 text-teal-700 hover:bg-teal-100 hover:text-teal-900 transition-all cursor-pointer shadow-2xs disabled:opacity-50"
                              title="Trigger Prospeo/Tomba email waterfall"
                            >
                              <Wand2 className={`h-3.5 w-3.5 text-teal-600 ${isEnriching ? 'animate-spin' : ''}`} />
                              <span>{isEnriching ? 'Enriching...' : '🪄 Enrich'}</span>
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
