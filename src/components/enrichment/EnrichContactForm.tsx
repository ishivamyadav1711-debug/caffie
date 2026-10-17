'use client';

import React, { useState } from 'react';
import {
  Sparkles,
  Search,
  Mail,
  Phone,
  Building2,
  User,
  Globe,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  Copy,
  Check,
  DollarSign,
  Cpu,
  Layers,
  ArrowRight,
  ShieldCheck,
  RefreshCw,
  AtSign,
} from 'lucide-react';
import { EnrichmentOutput, EnrichmentField } from '@/lib/enrichment/types';

export const EnrichContactForm: React.FC = () => {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [companyDomain, setCompanyDomain] = useState('');
  const [companyCountry, setCompanyCountry] = useState<'US' | 'IN' | 'CA'>('US');
  const [selectedFields, setSelectedFields] = useState<EnrichmentField[]>([
    'workEmail',
    'personalEmail',
    'phone',
  ]);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EnrichmentOutput | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const toggleField = (field: EnrichmentField) => {
    setSelectedFields((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]
    );
  };

  const handleCopy = (text: string, key: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handlePreset = (type: 'person' | 'domain' | 'phone' | 'personalEmail' | 'no-domain') => {
    setError(null);
    setResult(null);
    if (type === 'person') {
      setFirstName('Patrick');
      setLastName('Collison');
      setCompanyName('Stripe');
      setCompanyDomain('stripe.com');
      setCompanyCountry('US');
      setSelectedFields(['workEmail', 'personalEmail', 'phone']);
    } else if (type === 'domain') {
      setFirstName('');
      setLastName('');
      setCompanyName('Stripe');
      setCompanyDomain('stripe.com');
      setCompanyCountry('US');
      setSelectedFields(['workEmail', 'phone']);
    } else if (type === 'phone') {
      setFirstName('Patrick');
      setLastName('Collison');
      setCompanyName('Stripe');
      setCompanyDomain('stripe.com');
      setCompanyCountry('US');
      setSelectedFields(['phone']);
    } else if (type === 'personalEmail') {
      setFirstName('Patrick');
      setLastName('Collison');
      setCompanyName('Stripe');
      setCompanyDomain('stripe.com');
      setCompanyCountry('US');
      setSelectedFields(['personalEmail']);
    } else if (type === 'no-domain') {
      setFirstName('John');
      setLastName('Doe');
      setCompanyName('Acme Technologies');
      setCompanyDomain('');
      setCompanyCountry('US');
      setSelectedFields(['workEmail', 'personalEmail', 'phone']);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);

    // Validation: at least company_name or company_domain must be present
    if (!companyName.trim() && !companyDomain.trim()) {
      setError('Please provide either a Company Name or Company Domain.');
      return;
    }

    if (selectedFields.length === 0) {
      setError('Please select at least one field to enrich (Work Email, Personal Email, or Phone).');
      return;
    }

    setIsLoading(true);

    try {
      const payload = {
        first_name: firstName.trim() || null,
        last_name: lastName.trim() || null,
        company_name: companyName.trim() || null,
        company_domain: companyDomain.trim() || null,
        company_country: companyCountry || null,
        fields: selectedFields,
      };

      const res = await fetch('/api/enrichment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP error ${res.status}`);
      }

      setResult(data);
    } catch (err: any) {
      setError(err.message || 'An error occurred while contacting the enrichment service.');
    } finally {
      setIsLoading(false);
    }
  };

  const isPersonSearch = Boolean(firstName.trim());

  return (
    <div className="space-y-6">
      {/* Configuration Card */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-2xs overflow-hidden">
        {/* Card Header */}
        <div className="p-5 sm:p-6 border-b border-[#F1F5F9] bg-gradient-to-r from-slate-50/50 via-white to-slate-50/30">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-teal-500/10 border border-teal-500/20 text-teal-600 flex items-center justify-center shrink-0">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-[16px] font-bold text-[#0F172A] tracking-tight flex items-center gap-2">
                  Contact Enrichment Engine
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200">
                    Phase 3 Active
                  </span>
                </h2>
                <p className="text-[12.5px] text-[#64748B] mt-0.5">
                  Multi-provider waterfall: Work Email (Prospeo/Tomba), Personal Email (LeadMagic), Phone (Icypeas)
                </p>
              </div>
            </div>

            {/* Quick Test Presets */}
            <div className="flex items-center flex-wrap gap-1.5">
              <span className="text-[11px] font-medium text-[#94A3B8] mr-1">Presets:</span>
              <button
                type="button"
                onClick={() => handlePreset('person')}
                className="text-[11.5px] font-medium px-2.5 py-1 rounded-lg bg-[#F1F5F9] text-[#334155] hover:bg-[#E2E8F0] transition-colors cursor-pointer"
              >
                All Fields
              </button>
              <button
                type="button"
                onClick={() => handlePreset('domain')}
                className="text-[11.5px] font-medium px-2.5 py-1 rounded-lg bg-[#F1F5F9] text-[#334155] hover:bg-[#E2E8F0] transition-colors cursor-pointer"
              >
                Domain Search
              </button>
              <button
                type="button"
                onClick={() => handlePreset('phone')}
                className="text-[11.5px] font-medium px-2.5 py-1 rounded-lg bg-teal-50 text-teal-700 hover:bg-teal-100 transition-colors cursor-pointer border border-teal-200/50"
              >
                Phone Search
              </button>
              <button
                type="button"
                onClick={() => handlePreset('personalEmail')}
                className="text-[11.5px] font-medium px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors cursor-pointer border border-indigo-200/50"
              >
                Personal Email
              </button>
              <button
                type="button"
                onClick={() => handlePreset('no-domain')}
                className="text-[11.5px] font-medium px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-100 transition-colors cursor-pointer border border-rose-200/50"
              >
                Missing Domain (Fail)
              </button>
            </div>
          </div>
        </div>

        {/* Card Body & Form */}
        <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-6">
          {/* Active Mode Notice */}
          <div
            className={`p-3 rounded-xl border flex items-center justify-between gap-3 text-[12px] transition-colors ${
              isPersonSearch
                ? 'bg-blue-50/70 border-blue-200/70 text-blue-900'
                : 'bg-emerald-50/70 border-emerald-200/70 text-emerald-900'
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full animate-pulse ${
                  isPersonSearch ? 'bg-blue-600' : 'bg-emerald-600'
                }`}
              />
              <span className="font-semibold">
                {isPersonSearch ? 'Mode A: Person Search' : 'Mode B: Domain Search'}
              </span>
              <span className="text-slate-500 hidden sm:inline">•</span>
              <span className="text-slate-600 hidden sm:inline">
                {isPersonSearch
                  ? 'Person identified: Specific work email via Prospeo/Tomba, personal email via LeadMagic, phone via Icypeas.'
                  : 'Company-level only: Generic company email via Prospeo/Tomba, company phone via Icypeas.'}
              </span>
            </div>
            <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-white/80 border border-slate-200/60 shrink-0">
              {isPersonSearch ? 'SPECIFIC' : 'GENERIC'}
            </span>
          </div>

          {/* Form Inputs Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* First Name */}
            <div className="space-y-1.5">
              <label className="text-[12px] font-semibold text-[#334155] flex items-center justify-between">
                <span>First Name</span>
                <span className="text-[10.5px] text-[#94A3B8] font-normal">Optional</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="e.g. Patrick"
                  className="w-full pl-8 pr-3 py-2 text-[13px] rounded-xl border border-[#CBD5E1] bg-white placeholder-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all"
                />
                <User className="h-3.5 w-3.5 text-[#94A3B8] absolute left-2.5 top-3" />
              </div>
            </div>

            {/* Last Name */}
            <div className="space-y-1.5">
              <label className="text-[12px] font-semibold text-[#334155] flex items-center justify-between">
                <span>Last Name</span>
                <span className="text-[10.5px] text-[#94A3B8] font-normal">Optional</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="e.g. Collison"
                  className="w-full pl-8 pr-3 py-2 text-[13px] rounded-xl border border-[#CBD5E1] bg-white placeholder-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all"
                />
                <User className="h-3.5 w-3.5 text-[#94A3B8] absolute left-2.5 top-3" />
              </div>
            </div>

            {/* Company Name */}
            <div className="space-y-1.5">
              <label className="text-[12px] font-semibold text-[#334155] flex items-center justify-between">
                <span>Company Name</span>
                <span className="text-[10.5px] text-[#94A3B8] font-normal">Primary ID</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="e.g. Stripe"
                  className="w-full pl-8 pr-3 py-2 text-[13px] rounded-xl border border-[#CBD5E1] bg-white placeholder-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all"
                />
                <Building2 className="h-3.5 w-3.5 text-[#94A3B8] absolute left-2.5 top-3" />
              </div>
            </div>

            {/* Company Domain */}
            <div className="space-y-1.5">
              <label className="text-[12px] font-semibold text-[#334155] flex items-center justify-between">
                <span>Company Domain</span>
                <span className="text-[10.5px] text-teal-600 font-medium">Best Accuracy</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={companyDomain}
                  onChange={(e) => setCompanyDomain(e.target.value)}
                  placeholder="e.g. stripe.com"
                  className="w-full pl-8 pr-3 py-2 text-[13px] rounded-xl border border-[#CBD5E1] bg-white placeholder-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all"
                />
                <Globe className="h-3.5 w-3.5 text-[#94A3B8] absolute left-2.5 top-3" />
              </div>
            </div>
          </div>

          {/* Row 2: Country + Field Checkboxes */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2 border-t border-[#F1F5F9]">
            {/* Country Dropdown */}
            <div className="flex items-center gap-3">
              <label className="text-[12px] font-semibold text-[#334155] whitespace-nowrap">
                Company Country:
              </label>
              <select
                value={companyCountry}
                onChange={(e) => setCompanyCountry(e.target.value as 'US' | 'IN' | 'CA')}
                className="text-[13px] px-3 py-1.5 rounded-xl border border-[#CBD5E1] bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 cursor-pointer"
              >
                <option value="US">United States (US)</option>
                <option value="IN">India (IN)</option>
                <option value="CA">Canada (CA)</option>
              </select>
            </div>

            {/* Fields Checkboxes */}
            <div className="flex items-center gap-4 flex-wrap">
              <span className="text-[12px] font-semibold text-[#334155]">Enrich Fields:</span>
              <label className="flex items-center gap-2 text-[13px] text-[#334155] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={selectedFields.includes('workEmail')}
                  onChange={() => toggleField('workEmail')}
                  className="h-4 w-4 rounded text-teal-600 focus:ring-teal-500 border-gray-300 cursor-pointer"
                />
                <span>Work Email</span>
              </label>
              <label className="flex items-center gap-2 text-[13px] text-[#334155] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={selectedFields.includes('personalEmail')}
                  onChange={() => toggleField('personalEmail')}
                  className="h-4 w-4 rounded text-indigo-600 focus:ring-indigo-500 border-gray-300 cursor-pointer"
                />
                <span>Personal Email</span>
              </label>
              <label className="flex items-center gap-2 text-[13px] text-[#334155] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={selectedFields.includes('phone')}
                  onChange={() => toggleField('phone')}
                  className="h-4 w-4 rounded text-emerald-600 focus:ring-emerald-500 border-gray-300 cursor-pointer"
                />
                <span>Phone</span>
              </label>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200/80 text-rose-700 text-[12.5px] flex items-center gap-2.5 animate-fade-in">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          {/* Submit Action */}
          <div className="flex items-center justify-between pt-2 border-t border-[#F1F5F9]">
            <p className="text-[11.5px] text-[#94A3B8]">
              Prospeo: $0.01 • Tomba: $0.0078 • LeadMagic: $0.03 • Icypeas: $0.019
            </p>

            <button
              type="submit"
              disabled={isLoading}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold text-white shadow-xs transition-all cursor-pointer ${
                isLoading
                  ? 'bg-slate-400 cursor-not-allowed'
                  : 'bg-[#0F172A] hover:bg-slate-800 active:scale-[0.98]'
              }`}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-teal-300" />
                  <span>Enriching Contact...</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 text-teal-400" />
                  <span>Run Enrichment</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Result Display Section */}
      {result && (
        <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-2xs overflow-hidden animate-fade-in">
          {/* Result Header */}
          <div className="p-5 border-b border-[#F1F5F9] bg-gradient-to-r from-slate-50/60 to-white flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-lg bg-teal-50 text-teal-600 border border-teal-200/60 flex items-center justify-center shrink-0">
                <CheckCircle2 className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-[14px] font-bold text-[#0F172A]">Enrichment Results</h3>
                <p className="text-[12px] text-[#64748B]">
                  Waterfall execution finished in{' '}
                  <span className="font-semibold text-slate-800">
                    {result.routing.primaryIdentifier}
                  </span>{' '}
                  mode
                </p>
              </div>
            </div>

            {/* Metrics Badges */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-[#0F172A] text-[11.5px] font-semibold border border-slate-200/70">
                <DollarSign className="h-3.5 w-3.5 text-teal-600" />
                <span>Cost: ${result.totalCost.toFixed(4)}</span>
              </div>

              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-[#0F172A] text-[11.5px] font-semibold border border-slate-200/70">
                <RefreshCw className="h-3 w-3 text-slate-500" />
                <span>{result.cached ? 'Cached Hit' : 'Live Request'}</span>
              </div>

              {result.routing.domainMxValid !== null && (
                <div
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11.5px] font-semibold border ${
                    result.routing.domainMxValid
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200/60'
                      : 'bg-amber-50 text-amber-700 border-amber-200/60'
                  }`}
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span>{result.routing.domainMxValid ? 'MX Valid' : 'No MX'}</span>
                </div>
              )}
            </div>
          </div>

          {/* Cards Grid: Work Email, Personal Email & Phone */}
          <div className="p-5 sm:p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 1. Work Email Card */}
            <div className="p-4 rounded-xl border border-[#E2E8F0] bg-slate-50/40 hover:bg-white transition-all space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[12.5px] font-semibold text-[#334155]">
                  <Mail className="h-4 w-4 text-teal-600" />
                  <span>Work Email</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {result.workEmail?.type && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200/70">
                      {result.workEmail.type}
                    </span>
                  )}
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      result.workEmail?.status === 'FOUND'
                        ? 'bg-emerald-100 text-emerald-800'
                        : result.workEmail?.status === 'FAILED'
                        ? 'bg-rose-100 text-rose-800'
                        : result.workEmail?.status === 'SKIPPED'
                        ? 'bg-slate-100 text-slate-700'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {result.workEmail?.status || 'NOT_REQUESTED'}
                  </span>
                </div>
              </div>

              {/* Value Box */}
              <div className="p-3 rounded-lg bg-white border border-[#CBD5E1]/70 flex items-center justify-between gap-2 min-h-[48px]">
                <span className="text-[13.5px] font-medium text-[#0F172A] truncate">
                  {result.workEmail?.value || 'Not Found'}
                </span>
                {result.workEmail?.value && (
                  <button
                    type="button"
                    onClick={() => handleCopy(result.workEmail!.value!, 'workEmail')}
                    className="p-1.5 text-slate-400 hover:text-slate-700 rounded hover:bg-slate-100 transition-colors cursor-pointer"
                    title="Copy Work Email"
                  >
                    {copiedKey === 'workEmail' ? (
                      <Check className="h-3.5 w-3.5 text-teal-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                )}
              </div>

              {/* Metadata details */}
              <div className="flex items-center justify-between text-[11px] text-[#64748B] pt-1">
                <div className="flex items-center gap-1.5">
                  <Cpu className="h-3.5 w-3.5 text-slate-400" />
                  <span>Provider:</span>
                  <span className="font-semibold text-slate-800 uppercase">
                    {result.workEmail?.provider || 'None'}
                  </span>
                </div>
                {typeof result.workEmail?.confidence === 'number' && (
                  <div>
                    <span>Score: </span>
                    <span className="font-semibold text-emerald-600">
                      {Math.round(result.workEmail.confidence * 100)}%
                    </span>
                  </div>
                )}
                {result.workEmail?.reason && (
                  <span className="text-slate-500 italic truncate max-w-[130px]" title={result.workEmail.reason}>
                    {result.workEmail.reason}
                  </span>
                )}
              </div>
            </div>

            {/* 2. Personal Email Card (LeadMagic) */}
            <div className="p-4 rounded-xl border border-[#E2E8F0] bg-slate-50/40 hover:bg-white transition-all space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[12.5px] font-semibold text-[#334155]">
                  <AtSign className="h-4 w-4 text-indigo-600" />
                  <span>Personal Email</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {result.personalEmail?.type && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200/70">
                      {result.personalEmail.type}
                    </span>
                  )}
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      result.personalEmail?.status === 'FOUND'
                        ? 'bg-emerald-100 text-emerald-800'
                        : result.personalEmail?.status === 'SKIPPED'
                        ? 'bg-slate-100 text-slate-700'
                        : result.personalEmail?.status === 'FAILED'
                        ? 'bg-rose-100 text-rose-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {result.personalEmail?.status || 'NOT_REQUESTED'}
                  </span>
                </div>
              </div>

              {/* Value Box */}
              <div className="p-3 rounded-lg bg-white border border-[#CBD5E1]/70 flex items-center justify-between gap-2 min-h-[48px]">
                <span className="text-[13.5px] font-medium text-[#0F172A] truncate">
                  {result.personalEmail?.value || 'Not Found'}
                </span>
                {result.personalEmail?.value && (
                  <button
                    type="button"
                    onClick={() => handleCopy(result.personalEmail!.value!, 'personalEmail')}
                    className="p-1.5 text-slate-400 hover:text-slate-700 rounded hover:bg-slate-100 transition-colors cursor-pointer"
                    title="Copy Personal Email"
                  >
                    {copiedKey === 'personalEmail' ? (
                      <Check className="h-3.5 w-3.5 text-indigo-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                )}
              </div>

              {/* Metadata details */}
              <div className="flex items-center justify-between text-[11px] text-[#64748B] pt-1">
                <div className="flex items-center gap-1.5">
                  <Cpu className="h-3.5 w-3.5 text-slate-400" />
                  <span>Provider:</span>
                  <span className="font-semibold text-slate-800 uppercase">
                    {result.personalEmail?.provider || 'None'}
                  </span>
                </div>
                {result.personalEmail?.reason && (
                  <span className="text-slate-500 italic truncate max-w-[140px]" title={result.personalEmail.reason}>
                    {result.personalEmail.reason}
                  </span>
                )}
              </div>
            </div>

            {/* 3. Phone Card (Icypeas) */}
            <div className="p-4 rounded-xl border border-[#E2E8F0] bg-slate-50/40 hover:bg-white transition-all space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[12.5px] font-semibold text-[#334155]">
                  <Phone className="h-4 w-4 text-emerald-600" />
                  <span>Phone Number</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {result.phone?.type && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200/70">
                      {result.phone.type}
                    </span>
                  )}
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      result.phone?.status === 'FOUND'
                        ? 'bg-emerald-100 text-emerald-800'
                        : result.phone?.status === 'FAILED'
                        ? 'bg-rose-100 text-rose-800'
                        : result.phone?.status === 'SKIPPED'
                        ? 'bg-slate-100 text-slate-700'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {result.phone?.status || 'NOT_REQUESTED'}
                  </span>
                </div>
              </div>

              {/* Value Box */}
              <div className="p-3 rounded-lg bg-white border border-[#CBD5E1]/70 flex items-center justify-between gap-2 min-h-[48px]">
                <span className="text-[13.5px] font-medium text-[#0F172A] truncate">
                  {result.phone?.value || 'Not Found'}
                </span>
                {result.phone?.value && (
                  <button
                    type="button"
                    onClick={() => handleCopy(result.phone!.value!, 'phone')}
                    className="p-1.5 text-slate-400 hover:text-slate-700 rounded hover:bg-slate-100 transition-colors cursor-pointer"
                    title="Copy Phone"
                  >
                    {copiedKey === 'phone' ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                )}
              </div>

              {/* Metadata details */}
              <div className="flex items-center justify-between text-[11px] text-[#64748B] pt-1">
                <div className="flex items-center gap-1.5">
                  <Cpu className="h-3.5 w-3.5 text-slate-400" />
                  <span>Provider:</span>
                  <span className="font-semibold text-slate-800 uppercase">
                    {result.phone?.provider || 'None'}
                  </span>
                </div>
                {result.phone?.reason && (
                  <span className="text-slate-500 italic truncate max-w-[140px]" title={result.phone.reason}>
                    {result.phone.reason}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Waterfall Pipeline Plan */}
          <div className="px-5 pb-5">
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/70 space-y-2">
              <div className="flex items-center gap-2 text-[11.5px] font-bold text-[#0F172A] uppercase tracking-wider">
                <Layers className="h-3.5 w-3.5 text-teal-600" />
                <span>Planned Waterfall Execution Flow</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[12px]">
                <div className="flex items-center gap-2 text-slate-700 bg-white p-2 rounded-lg border border-slate-200/50">
                  <span className="font-semibold text-slate-900">Work Email:</span>
                  <span className="text-slate-600 truncate">
                    {result.routing.plannedWaterfall.workEmail?.join(' → ') || 'None'}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-slate-700 bg-white p-2 rounded-lg border border-slate-200/50">
                  <span className="font-semibold text-slate-900">Personal Email:</span>
                  <span className="text-slate-600 truncate">
                    {result.routing.plannedWaterfall.personalEmail?.join(' → ') || 'None'}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-slate-700 bg-white p-2 rounded-lg border border-slate-200/50">
                  <span className="font-semibold text-slate-900">Phone:</span>
                  <span className="text-slate-600 truncate">
                    {result.routing.plannedWaterfall.phone?.join(' → ') || 'None'}
                  </span>
                </div>
              </div>
            </div>

            {/* Collapsible Raw JSON payload for dev inspect */}
            <details className="mt-3 text-[12px] text-slate-500">
              <summary className="cursor-pointer font-medium hover:text-slate-800 transition-colors">
                View Raw API JSON Response
              </summary>
              <pre className="mt-2 p-3 rounded-xl bg-slate-900 text-teal-300 font-mono text-[11px] overflow-x-auto max-h-64">
                {JSON.stringify(result, null, 2)}
              </pre>
            </details>
          </div>
        </div>
      )}
    </div>
  );
};
