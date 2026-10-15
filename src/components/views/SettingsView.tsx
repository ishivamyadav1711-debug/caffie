'use client';

import React, { useState, useEffect } from 'react';
import { 
  Settings, 
  Key, 
  Shield, 
  Sliders, 
  Bell, 
  Globe, 
  Save, 
  CheckCircle2, 
  CreditCard,
  Mail,
  Phone,
  MessageSquare,
  AlertTriangle,
  Loader2
} from 'lucide-react';
import { SenderAccountsManager } from '@/components/outreach/SenderAccountsManager';

interface SettingsViewProps {
  onShowToast: (title: string, desc?: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ onShowToast }) => {
  const [activeSection, setActiveSection] = useState<'general' | 'scraper' | 'outreach' | 'api'>('general');
  const [agencyName, setAgencyName] = useState('Apex Growth Partners');
  const [senderEmail, setSenderEmail] = useState('utkarsh@leadpilot.agency');
  const [rateLimit, setRateLimit] = useState('40 requests/min');
  const [providerStatus, setProviderStatus] = useState<any>({
    email: { configured: false, provider: 'none', ready: false },
    sms: { configured: false, provider: 'none', ready: false },
    whatsapp: { configured: false, provider: 'none', ready: false },
  });
  const [loadingProviders, setLoadingProviders] = useState(true);

  useEffect(() => {
    fetch('/api/outreach/status')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.providers) {
          setProviderStatus(data.providers);
        }
      })
      .catch((err) => console.error('Failed to fetch provider status:', err))
      .finally(() => setLoadingProviders(false));
  }, []);

  const saveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    onShowToast('Settings Saved', 'Workspace configuration updated successfully.', 'success');
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-lg border border-[#E5E7EB] shadow-subtle">
        <div>
          <h1 className="text-[16px] font-bold text-[#171717]">Workspace Settings & Integrations</h1>
          <p className="text-[12px] text-[#6B7280]">
            Manage scraping throttle rates, sender domain authentication, and outreach automation parameters.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Settings Navigation */}
        <div className="space-y-1">
          {[
            { id: 'general', label: 'Agency Profile', icon: Settings },
            { id: 'scraper', label: 'Scraper Engine & Proxies', icon: Sliders },
            { id: 'outreach', label: 'Outreach Providers & Delivery', icon: Mail },
            { id: 'api', label: 'API Keys & Webhooks', icon: Key },
          ].map((item) => {
            const Icon = item.icon;
            const isSelected = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id as any)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[12.5px] font-medium text-left transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-teal-50 text-teal-800 font-semibold border border-teal-200/80'
                    : 'text-[#4B5563] hover:bg-[#F3F4F6]'
                }`}
              >
                <Icon className={`h-4 w-4 ${isSelected ? 'text-teal-700' : 'text-[#6B7280]'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Settings Form Body */}
        <div className="md:col-span-3 bg-white rounded-lg border border-[#E5E7EB] shadow-subtle p-5">
          <form onSubmit={saveSettings} className="space-y-4 text-[12.5px]">
            {activeSection === 'general' && (
              <div className="space-y-4">
                <h3 className="text-[14px] font-bold text-[#171717] border-b border-[#F1F3F5] pb-2">
                  Agency Profile
                </h3>

                <div>
                  <label className="block text-[11.5px] font-semibold text-[#374151] mb-1">
                    Agency / Business Name
                  </label>
                  <input
                    type="text"
                    value={agencyName}
                    onChange={(e) => setAgencyName(e.target.value)}
                    className="w-full rounded-md border border-[#D1D5DB] bg-[#F7F8FA] px-3 py-1.5 text-[12.5px] text-[#171717] focus:border-teal-700 focus:bg-white focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11.5px] font-semibold text-[#374151] mb-1">
                    Primary Notification Email
                  </label>
                  <input
                    type="email"
                    value={senderEmail}
                    onChange={(e) => setSenderEmail(e.target.value)}
                    className="w-full rounded-md border border-[#D1D5DB] bg-[#F7F8FA] px-3 py-1.5 text-[12.5px] text-[#171717] focus:border-teal-700 focus:bg-white focus:outline-none"
                  />
                </div>
              </div>
            )}

            {activeSection === 'scraper' && (
              <div className="space-y-4">
                <h3 className="text-[14px] font-bold text-[#171717] border-b border-[#F1F3F5] pb-2">
                  Scraper Throttling & Rotation
                </h3>

                <div>
                  <label className="block text-[11.5px] font-semibold text-[#374151] mb-1">
                    Concurrency & Rate Limit
                  </label>
                  <select
                    value={rateLimit}
                    onChange={(e) => setRateLimit(e.target.value)}
                    className="w-full rounded-md border border-[#D1D5DB] bg-[#F7F8FA] px-3 py-1.5 text-[12.5px] text-[#171717] focus:border-teal-700 focus:bg-white focus:outline-none"
                  >
                    <option value="20 requests/min">Conservative (20 req/min) - High Stealth</option>
                    <option value="40 requests/min">Standard (40 req/min) - Recommended</option>
                    <option value="80 requests/min">Turbo (80 req/min) - High Concurrency</option>
                  </select>
                </div>
              </div>
            )}

            {activeSection === 'outreach' && (
              <div className="space-y-4">
                <h3 className="text-[14px] font-bold text-[#171717] border-b border-[#F1F3F5] pb-2">
                  Live Automated Outreach Channels & Providers
                </h3>

                {/* Email Provider Card */}
                <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-teal-700" />
                      <span className="font-bold text-slate-800">Email Dispatch Provider</span>
                      <span className="text-[11px] text-slate-500 font-mono">({providerStatus.email.provider || 'Resend / SendGrid'})</span>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10.5px] font-bold border ${
                        providerStatus.email.ready
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-amber-50 text-amber-800 border-amber-200'
                      }`}
                    >
                      {providerStatus.email.ready ? 'CONFIGURED & READY' : 'NOT CONFIGURED'}
                    </span>
                  </div>
                  <p className="text-[11.5px] text-slate-600">
                    Transmits evidence-grounded audit reports directly to verified prospect inboxes. Configure <code className="px-1 py-0.5 rounded bg-slate-200 font-mono text-[11px]">RESEND_API_KEY</code> and <code className="px-1 py-0.5 rounded bg-slate-200 font-mono text-[11px]">RESEND_FROM_EMAIL</code> in <code className="font-mono text-[11px]">.env</code> to activate.
                  </p>
                </div>

                {/* SMS Provider Card */}
                <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Phone className="h-4 w-4 text-indigo-700" />
                      <span className="font-bold text-slate-800">SMS Dispatch Provider</span>
                      <span className="text-[11px] text-slate-500 font-mono">(Twilio REST API)</span>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10.5px] font-bold border ${
                        providerStatus.sms.ready
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-amber-50 text-amber-800 border-amber-200'
                      }`}
                    >
                      {providerStatus.sms.ready ? 'CONFIGURED & READY' : 'NOT CONFIGURED'}
                    </span>
                  </div>
                  <p className="text-[11.5px] text-slate-600">
                    Dispatches concise text alerts with interactive prototype links. Configure <code className="px-1 py-0.5 rounded bg-slate-200 font-mono text-[11px]">TWILIO_ACCOUNT_SID</code>, <code className="px-1 py-0.5 rounded bg-slate-200 font-mono text-[11px]">TWILIO_AUTH_TOKEN</code>, and <code className="px-1 py-0.5 rounded bg-slate-200 font-mono text-[11px]">TWILIO_PHONE_NUMBER</code> in <code className="font-mono text-[11px]">.env</code> to activate.
                  </p>
                </div>

                {/* WhatsApp Provider Card */}
                <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="h-4 w-4 text-emerald-700" />
                      <span className="font-bold text-slate-800">WhatsApp Dispatch Provider</span>
                      <span className="text-[11px] text-slate-500 font-mono">(Meta WhatsApp Cloud API v20.0)</span>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10.5px] font-bold border ${
                        providerStatus.whatsapp.ready
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-amber-50 text-amber-800 border-amber-200'
                      }`}
                    >
                      {providerStatus.whatsapp.ready ? 'CONFIGURED & READY' : 'NOT CONFIGURED'}
                    </span>
                  </div>
                  <p className="text-[11.5px] text-slate-600">
                    Direct business messaging via official Graph API v20.0 endpoints. Configure <code className="px-1 py-0.5 rounded bg-slate-200 font-mono text-[11px]">WHATSAPP_API_TOKEN</code> and <code className="px-1 py-0.5 rounded bg-slate-200 font-mono text-[11px]">WHATSAPP_PHONE_NUMBER_ID</code> in <code className="font-mono text-[11px]">.env</code> to activate.
                  </p>
                </div>

                {/* Company Sender Mailboxes Manager */}
                <div className="pt-4 border-t border-slate-200">
                  <SenderAccountsManager />
                </div>
              </div>
            )}

            {activeSection === 'api' && (
              <div className="space-y-4">
                <h3 className="text-[14px] font-bold text-[#171717] border-b border-[#F1F3F5] pb-2">
                  External Provider Credentials & Database
                </h3>

                <div>
                  <label className="block text-[11.5px] font-semibold text-[#374151] mb-1">
                    Canonical Database Engine
                  </label>
                  <div className="p-2.5 rounded-md border border-emerald-200 bg-emerald-50/50 font-mono text-[12px] text-emerald-900 flex items-center justify-between">
                    <span>SQLite / PostgreSQL (Prisma Canonical Schema)</span>
                    <span className="text-[11px] font-sans font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">CONNECTED</span>
                  </div>
                </div>

                <div>
                  <label className="block text-[11.5px] font-semibold text-[#374151] mb-1">
                    Google Places API Key (Business Discovery)
                  </label>
                  <input
                    type="password"
                    placeholder="AIzaSy... (Configured via GOOGLE_PLACES_API_KEY in .env)"
                    defaultValue="******** (Configured on Server)"
                    disabled
                    className="w-full rounded-md border border-[#D1D5DB] bg-[#F7F8FA] px-3 py-1.5 text-[12.5px] text-[#171717] focus:border-teal-700 focus:bg-white focus:outline-none font-mono opacity-70 cursor-not-allowed"
                  />
                  <p className="text-[11px] text-[#6B7280] mt-1">
                    Used for real-time global discovery, place ratings, and verified review counts.
                  </p>
                </div>

                <div>
                  <label className="block text-[11.5px] font-semibold text-[#374151] mb-1">
                    Google PageSpeed Insights API Key
                  </label>
                  <input
                    type="password"
                    placeholder="AIzaSy... (Configured via PAGESPEED_API_KEY in .env)"
                    className="w-full rounded-md border border-[#D1D5DB] bg-[#F7F8FA] px-3 py-1.5 text-[12.5px] text-[#171717] focus:border-teal-700 focus:bg-white focus:outline-none font-mono"
                  />
                  <p className="text-[11px] text-[#6B7280] mt-1">
                    Used for authentic Lighthouse mobile performance, accessibility, and Core Web Vitals scoring.
                  </p>
                </div>
              </div>
            )}

            <div className="pt-3 border-t border-[#F1F3F5] flex justify-end">
              <button
                type="submit"
                className="flex items-center gap-1.5 rounded-md bg-teal-700 hover:bg-teal-800 text-white px-4 py-1.5 text-[12.5px] font-medium transition-all shadow-subtle cursor-pointer"
              >
                <Save className="h-3.5 w-3.5" />
                <span>Save Changes</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
