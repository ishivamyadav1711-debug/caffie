'use client';

import React, { useState, useEffect } from 'react';
import { 
  X, 
  Globe, 
  ExternalLink, 
  Mail, 
  Phone, 
  MapPin, 
  Building2, 
  Sparkles, 
  MonitorPlay, 
  Copy, 
  Check, 
  Send, 
  Edit3, 
  FileSearch,
  Loader2,
  AlertTriangle,
  ShieldCheck,
  MessageSquare,
  Download,
  CheckCircle2,
  Clock,
  ShieldAlert
} from 'lucide-react';
import { Lead, OutreachRecord } from '@/types';
import { getLeadWebsiteStatusBadge, WebsiteBadgeConfig } from '@/utils/statusUtils';

export { getLeadWebsiteStatusBadge };
export type { WebsiteBadgeConfig };

interface LeadDetailDrawerProps {
  lead: Lead | null;
  onClose: () => void;
  onQuickAudit: (lead: Lead) => void;
  onShowToast: (title: string, desc?: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
}

export const LeadDetailDrawer: React.FC<LeadDetailDrawerProps> = ({
  lead,
  onClose,
  onQuickAudit,
  onShowToast,
}) => {
  // Outreach state
  const [isGeneratingOutreach, setIsGeneratingOutreach] = useState(false);
  const [outreachMessage, setOutreachMessage] = useState<string | null>(null);
  const [isEditingOutreach, setIsEditingOutreach] = useState(false);
  const [copiedOutreach, setCopiedOutreach] = useState(false);

  // Live Outreach & Preview state
  const [outreachHistory, setOutreachHistory] = useState<OutreachRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [isSendingLive, setIsSendingLive] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<'EMAIL' | 'SMS' | 'WHATSAPP'>('EMAIL');
  const [modalSubject, setModalSubject] = useState('');
  const [modalBody, setModalBody] = useState('');

  // Demo state
  const [isGeneratingDemo, setIsGeneratingDemo] = useState(false);
  const [demoReady, setDemoReady] = useState(false);
  const [previewDemoOpen, setPreviewDemoOpen] = useState(false);

  // Copy contact states
  const [copiedPhone, setCopiedPhone] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState(false);

  const fetchOutreachHistory = async () => {
    if (!lead?.id) return;
    setLoadingHistory(true);
    try {
      const res = await fetch(`/api/outreach/history?leadId=${lead.id}`);
      const data = await res.json();
      if (data.success) {
        setOutreachHistory(data.outreaches || []);
      }
    } catch {
      setOutreachHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    if (lead) {
      setOutreachMessage(null);
      setIsEditingOutreach(false);
      setDemoReady(lead.demoGenerated || false);
      setIsGeneratingDemo(false);
      setIsGeneratingOutreach(false);
      setPreviewDemoOpen(false);
      setIsPreviewModalOpen(false);
      fetchOutreachHistory();
    }
  }, [lead?.id]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && lead) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lead, onClose]);

  if (!lead) return null;

  const detectedIssues = (lead.website.detectedIssues && lead.website.detectedIssues.length > 0)
    ? lead.website.detectedIssues
    : lead.auditIssues && lead.auditIssues.length > 0
    ? lead.auditIssues
    : lead.website.qualityReason
    ? [lead.website.qualityReason]
    : lead.website.hasWebsite
    ? ['All core technical and responsiveness checks passed']
    : ['No detected website found for this business'];

  const handleCopyPhone = () => {
    if (!lead.contact.phone) return;
    navigator.clipboard.writeText(lead.contact.phone);
    setCopiedPhone(true);
    setTimeout(() => setCopiedPhone(false), 2000);
    onShowToast('Phone Copied', lead.contact.phone, 'info');
  };

  const handleCopyEmail = () => {
    if (!lead.contact.email) return;
    navigator.clipboard.writeText(lead.contact.email);
    setCopiedEmail(true);
    setTimeout(() => setCopiedEmail(false), 2000);
    onShowToast('Email Copied', lead.contact.email, 'info');
  };

  const handleGenerateOutreach = () => {
    setIsGeneratingOutreach(true);

    const issuesSnippet = detectedIssues.length > 0
      ? detectedIssues.slice(0, 2).join(' and ')
      : 'potential mobile and conversion enhancements';

    const evidenceClaim = lead.website.hasWebsite
      ? `testing your official website (${lead.website.url || 'online listing'}) revealed ${issuesSnippet}, which may impact prospective client inquiries.`
      : `customers searching for ${lead.industry.toLowerCase()} services in ${lead.location.city} are visiting competitor sites because your business profile lacks an active, modern website.`;

    const generated = `Hello ${lead.contact.name || lead.businessName} Team,\n\nI was reviewing leading ${lead.industry.toLowerCase()} businesses in ${lead.location.city} and noted your strong presence.\n\nWhile analyzing your digital touchpoints, our diagnostic scan indicated that ${evidenceClaim}\n\nWe put together a streamlined mobile-first concept showing how resolving this could improve customer conversion for ${lead.businessName}.\n\nWould you be open to a brief 30-second review?\n\nSincerely,\nGrowth Operations\nLeadPilot`;

    setOutreachMessage(generated);
    setIsGeneratingOutreach(false);
    onShowToast('Evidence-Based Pitch Generated', `Personalized from verified audit findings.`, 'success');
  };

  const handleCopyOutreach = () => {
    if (!outreachMessage) return;
    navigator.clipboard.writeText(outreachMessage);
    setCopiedOutreach(true);
    setTimeout(() => setCopiedOutreach(false), 2000);
    onShowToast('Copied to Clipboard', 'Outreach message ready to paste.', 'success');
  };

  const handleOpenOutreachPreview = async () => {
    setIsGeneratingOutreach(true);
    try {
      const res = await fetch('/api/outreach/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: lead.id, previewOnly: true }),
      });
      const data = await res.json();
      if (data.success) {
        setPreviewData(data);
        const rec = data.eligibility.recommendedChannel;
        const initialChannel = (rec !== 'NONE' && (rec === 'EMAIL' || rec === 'SMS' || rec === 'WHATSAPP')) ? rec : 'EMAIL';
        setSelectedChannel(initialChannel);
        
        if (initialChannel === 'EMAIL') {
          setModalSubject(data.generated.subject || '');
          setModalBody(data.generated.bodyText || data.generated.emailBody || '');
        } else if (initialChannel === 'SMS') {
          setModalSubject('');
          setModalBody(data.generated.smsMessage || data.generated.smsBody || '');
        } else {
          setModalSubject('');
          setModalBody(data.generated.whatsAppMessage || data.generated.whatsappBody || '');
        }

        setIsPreviewModalOpen(true);
      } else {
        onShowToast('Outreach Eligibility Notice', data.error || 'Failed to generate outreach preview.', 'warning');
      }
    } catch (err: any) {
      onShowToast('Error', err.message || 'Failed to connect to outreach service.', 'error');
    } finally {
      setIsGeneratingOutreach(false);
    }
  };

  const handleSelectChannel = (ch: 'EMAIL' | 'SMS' | 'WHATSAPP') => {
    setSelectedChannel(ch);
    if (!previewData?.generated) return;
    if (ch === 'EMAIL') {
      setModalSubject(previewData.generated.subject || '');
      setModalBody(previewData.generated.bodyText || previewData.generated.emailBody || '');
    } else if (ch === 'SMS') {
      setModalSubject('');
      setModalBody(previewData.generated.smsMessage || previewData.generated.smsBody || '');
    } else {
      setModalSubject('');
      setModalBody(previewData.generated.whatsAppMessage || previewData.generated.whatsappBody || '');
    }
  };

  const handleExecuteLiveSend = async () => {
    setIsSendingLive(true);
    try {
      const res = await fetch('/api/outreach/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          leadId: lead.id, 
          channel: selectedChannel,
          subject: selectedChannel === 'EMAIL' ? modalSubject : undefined,
          body: modalBody
        }),
      });
      const data = await res.json();
      if (data.success) {
        setIsPreviewModalOpen(false);
        onShowToast(
          'Outreach Transmitted',
          `Message sent to ${data.outreach.recipient} via ${data.outreach.provider} (ID: ${data.outreach.providerMessageId || 'Confirmed'}).`,
          'success'
        );
        fetchOutreachHistory();
      } else {
        onShowToast(
          'Transmission Notice',
          data.error || data.outreach?.errorMessage || 'Outreach could not be transmitted.',
          'warning'
        );
        fetchOutreachHistory();
      }
    } catch (err: any) {
      onShowToast('Transmission Error', err.message || 'Failed to transmit outreach.', 'error');
    } finally {
      setIsSendingLive(false);
    }
  };

  const handleGenerateDemo = () => {
    setIsGeneratingDemo(true);
    setDemoReady(true);
    setIsGeneratingDemo(false);
    onShowToast('Demo Ready', `Interactive client concept prepared for ${lead.businessName}.`, 'success');
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/35 backdrop-blur-[2px] flex justify-end transition-opacity">
      {/* Backdrop */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Drawer */}
      <div className="relative w-full max-w-lg bg-white h-full shadow-2xl border-l border-[#E2E8F0] flex flex-col z-10 animate-slide-in-right select-none overflow-y-auto">
        {/* Drawer Header */}
        <div className="p-5 border-b border-[#E2E8F0] flex items-start justify-between bg-white sticky top-0 z-20">
          <div>
            <h2 className="text-[17px] font-bold text-[#0F172A] tracking-tight">
              {lead.businessName}
            </h2>
            <div className="flex items-center gap-2 mt-1 text-[12px] text-[#64748B]">
              <span className="font-medium text-[#334155]">{lead.industry}</span>
              <span>•</span>
              <span>{lead.location.city}{lead.location.state ? `, ${lead.location.state}` : ''}</span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="h-9 w-9 min-h-[36px] min-w-[36px] rounded-xl text-[#94A3B8] hover:text-[#0F172A] hover:bg-[#F1F5F9] flex items-center justify-center transition-colors btn-pressable cursor-pointer"
            title="Close drawer (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Drawer Content */}
        <div className="p-6 space-y-6">
          {/* Section: Contact & Location */}
          <div className="grid grid-cols-2 gap-4 p-4 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-[12.5px]">
            <div>
              <span className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-1">
                Phone
              </span>
              {lead.contact.phone ? (
                <button
                  onClick={handleCopyPhone}
                  className="font-medium text-[#0F172A] hover:text-teal-700 flex items-center gap-1.5 transition-colors cursor-pointer btn-pressable min-h-[32px]"
                  title="Click to copy phone"
                >
                  <Phone className="h-3.5 w-3.5 text-[#94A3B8]" />
                  <span>{lead.contact.phone}</span>
                  {copiedPhone && <Check className="h-3 w-3 text-emerald-600" />}
                </button>
              ) : (
                <span className="text-[#94A3B8] text-[12px]">Not available</span>
              )}
            </div>

            <div>
              <span className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-1">
                Email
              </span>
              {lead.contact.email ? (
                <button
                  onClick={handleCopyEmail}
                  className="font-medium text-[#0F172A] hover:text-teal-700 flex items-center gap-1.5 transition-colors truncate max-w-full cursor-pointer btn-pressable min-h-[32px]"
                  title="Click to copy email"
                >
                  <Mail className="h-3.5 w-3.5 text-[#94A3B8] shrink-0" />
                  <span className="truncate">{lead.contact.email}</span>
                  {copiedEmail && <Check className="h-3 w-3 text-emerald-600 shrink-0" />}
                </button>
              ) : (
                <span className="text-[#94A3B8] text-[12px]">Not available</span>
              )}
            </div>
          </div>

          {/* Section: Commercial & GMV */}
          <div className="p-4 rounded-xl border border-[#E2E8F0] bg-white space-y-3 shadow-2xs">
             <div className="flex items-center gap-2 mb-2">
                <Building2 className="h-4 w-4 text-teal-600" />
                <h3 className="text-[13px] font-bold text-[#0F172A]">Commercial Intelligence</h3>
             </div>
             
             {lead.commercialMilestones && lead.commercialMilestones.length > 0 ? (
                lead.commercialMilestones.map((milestone, idx) => (
                  <div key={idx} className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-[12px] space-y-2">
                     <div className="flex justify-between items-center">
                        <span className="font-bold text-slate-800">GMV: {milestone.gmvAmount ? (milestone.gmvCurrency === 'USD' ? '$' : '') + (milestone.gmvAmount >= 1000000 ? (milestone.gmvAmount / 1000000).toFixed(1) + 'M' : milestone.gmvAmount.toLocaleString()) : 'Verified'}</span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 uppercase">
                          {milestone.verificationStatus || 'VERIFIED'}
                        </span>
                     </div>
                     <div className="text-slate-600">
                        Date: <span className="font-semibold text-slate-800">{milestone.eventDate}</span> 
                        <span className="text-slate-400 ml-1">({milestone.dateAccuracy || 'Precision Unknown'})</span>
                     </div>
                     {milestone.evidence && milestone.evidence.length > 0 && (
                       <div className="mt-2 text-[11px] text-slate-500 border-t border-slate-200 pt-2">
                         <div className="font-semibold text-slate-700 mb-1">Evidence Source:</div>
                         <a href={milestone.evidence[0].sourceUrl} target="_blank" rel="noreferrer" className="text-teal-600 hover:underline truncate block">
                           {milestone.evidence[0].sourceTitle || milestone.evidence[0].sourceUrl}
                         </a>
                         <div className="mt-1 italic border-l-2 border-slate-300 pl-2 bg-slate-100 p-1 rounded-r">
                           "{milestone.evidence[0].evidenceText}"
                         </div>
                       </div>
                     )}
                  </div>
                ))
             ) : (
                <div className="text-[12.5px] font-medium text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-200">
                  GMV: Not publicly verified
                </div>
             )}
          </div>

          {/* Section: Website & Status */}
          <div className="space-y-3.5">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-1">
                  Website
                </span>
                {lead.website.hasWebsite && lead.website.url ? (
                  <div className="flex items-center gap-2">
                    <a
                      href={`https://${lead.website.url}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[13px] font-medium text-teal-700 hover:text-teal-800 hover:underline inline-flex items-center gap-1"
                    >
                      <span>{lead.website.url}</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                ) : (
                  <span className="text-[13px] font-medium text-[#0F172A]">
                    No Website
                  </span>
                )}
              </div>

              <div className="text-right">
                <span className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-1">
                  Website Status
                </span>
                {(() => {
                  const badge = getLeadWebsiteStatusBadge(lead);
                  return (
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wider ${badge.badgeClass}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${badge.dotClass}`} />
                      {badge.label}
                    </span>
                  );
                })()}
              </div>
            </div>

            {/* DETECTED WEBSITE ISSUES */}
            <div className="p-4 rounded-xl border border-[#E2E8F0] bg-white space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-[#475569] uppercase tracking-wider">
                  Detected Website Issues
                </span>
                {lead.website.hasWebsite && detectedIssues.length > 0 && (
                  <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">
                    {detectedIssues.length} {detectedIssues.length === 1 ? 'issue' : 'issues'} detected
                  </span>
                )}
              </div>
              <ul className="space-y-1.5 text-[12.5px] text-[#334155]">
                {detectedIssues.map((issue, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="text-amber-500 font-bold">•</span>
                    <span>{issue}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Primary Actions: [ Audit Website ] [ Generate AI Message ] [ Create Website Demo ] */}
          <div className="space-y-3 pt-2">
            <span className="text-[11px] font-bold text-[#475569] uppercase tracking-wider block">
              Actions
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {/* Audit Website Action */}
              <button
                onClick={() => onQuickAudit(lead)}
                className="flex items-center justify-center gap-1.5 h-10 min-h-[40px] px-3 rounded-xl border border-[#CBD5E1] bg-white text-[12px] font-medium text-[#0F172A] hover:bg-[#F8FAFC] transition-colors shadow-2xs cursor-pointer btn-pressable"
              >
                <FileSearch className="h-3.5 w-3.5 text-[#64748B]" />
                <span>Audit Website</span>
              </button>

              {/* Send Outreach Action */}
              <button
                onClick={handleOpenOutreachPreview}
                disabled={isGeneratingOutreach}
                className="flex items-center justify-center gap-1.5 h-10 min-h-[40px] px-3 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-[12px] font-semibold transition-colors shadow-2xs cursor-pointer disabled:opacity-75 btn-pressable"
                title="Review evidence and initiate real automated outreach"
              >
                {isGeneratingOutreach ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />
                ) : (
                  <Send className="h-3.5 w-3.5 text-teal-200" />
                )}
                <span>Send Outreach</span>
              </button>

              {/* Create Website Demo Action */}
              <button
                onClick={handleGenerateDemo}
                disabled={isGeneratingDemo || demoReady}
                className={`flex items-center justify-center gap-1.5 h-10 min-h-[40px] px-3 rounded-xl text-[12px] font-medium transition-colors shadow-2xs cursor-pointer btn-pressable ${
                  demoReady
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 cursor-default'
                    : 'border border-[#CBD5E1] bg-white text-[#0F172A] hover:bg-[#F8FAFC]'
                }`}
              >
                {isGeneratingDemo ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-teal-600" />
                ) : (
                  <MonitorPlay className="h-3.5 w-3.5 text-teal-600" />
                )}
                <span>{demoReady ? 'Demo Ready' : 'Create Website Demo'}</span>
              </button>
            </div>
          </div>

          {/* 11. AI Outreach Section (revealed on action) */}
          {outreachMessage && (
            <div className="p-4 rounded-xl border border-teal-200 bg-teal-50/40 space-y-3 animate-fade-in">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-bold text-[#0F172A] flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-teal-600" />
                  AI Personalized Message
                </span>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setIsEditingOutreach(!isEditingOutreach)}
                    className="p-1 text-[#64748B] hover:text-[#0F172A] rounded transition-colors cursor-pointer"
                    title={isEditingOutreach ? 'Done editing' : 'Edit message'}
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                  </button>

                  <button
                    onClick={handleCopyOutreach}
                    className="p-1 text-[#64748B] hover:text-[#0F172A] rounded transition-colors cursor-pointer"
                    title="Copy message"
                  >
                    {copiedOutreach ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>

              {isEditingOutreach ? (
                <textarea
                  value={outreachMessage}
                  onChange={(e) => setOutreachMessage(e.target.value)}
                  rows={6}
                  className="w-full rounded-lg border border-[#CBD5E1] bg-white p-2.5 text-[12px] text-[#0F172A] focus:outline-none focus:border-[#0F172A]"
                />
              ) : (
                <div className="p-3 bg-white rounded-lg border border-[#E2E8F0] text-[12px] text-[#334155] whitespace-pre-line leading-relaxed">
                  {outreachMessage}
                </div>
              )}

              {/* Outreach Action buttons: [ Edit ] [ Copy ] [ Send ] */}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  onClick={() => setIsEditingOutreach(!isEditingOutreach)}
                  className="px-3 py-1.5 rounded-lg border border-[#CBD5E1] bg-white text-[11.5px] font-medium text-[#334155] hover:bg-[#F8FAFC] cursor-pointer"
                >
                  {isEditingOutreach ? 'Save Edit' : 'Edit'}
                </button>

                <button
                  onClick={handleCopyOutreach}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#CBD5E1] bg-white text-[11.5px] font-medium text-[#334155] hover:bg-[#F8FAFC] cursor-pointer"
                >
                  {copiedOutreach ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                  <span>Copy</span>
                </button>

                <button
                  onClick={handleOpenOutreachPreview}
                  className="inline-flex items-center gap-1 px-3.5 py-1.5 rounded-lg bg-[#0F172A] hover:bg-[#1E293B] text-white text-[11.5px] font-semibold cursor-pointer"
                >
                  <Send className="h-3 w-3 text-teal-400" />
                  <span>Send</span>
                </button>
              </div>
            </div>
          )}

          {/* 12. Website Demo Section (revealed when demo is ready) */}
          {demoReady && (
            <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/50 flex items-center justify-between animate-fade-in">
              <div>
                <p className="text-[12.5px] font-bold text-[#0F172A] flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-emerald-600" />
                  Demo Ready
                </p>
                <p className="text-[11.5px] text-[#64748B] mt-0.5">
                  High-converting preview generated for {lead.businessName}.
                </p>
              </div>

              <button
                onClick={() => setPreviewDemoOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#0F172A] hover:bg-[#1E293B] text-white text-[12px] font-semibold transition-colors cursor-pointer"
              >
                <span>Preview Demo</span>
                <ExternalLink className="h-3 w-3 text-teal-400" />
              </button>
            </div>
          )}

          {/* 13. Persistent Outreach Activity & Delivery History */}
          <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-3 shadow-2xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Send className="h-4 w-4 text-teal-600" />
                <h3 className="text-[13px] font-bold text-[#0F172A]">
                  Outreach Activity & Delivery
                </h3>
                <span className="px-2 py-0.5 rounded-full bg-slate-100 text-[#475569] text-[11px] font-semibold">
                  {outreachHistory.length}
                </span>
              </div>

              {outreachHistory.length > 0 && (
                <a
                  href={`/api/outreach/export?leadId=${lead.id}`}
                  download
                  className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-teal-700 hover:text-teal-800 transition-colors"
                  title="Download complete delivery audit as Excel (.xlsx)"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Export (.xlsx)</span>
                </a>
              )}
            </div>

            {loadingHistory ? (
              <div className="py-4 flex items-center justify-center gap-2 text-slate-500 text-[12px]">
                <Loader2 className="h-4 w-4 animate-spin text-teal-600" />
                <span>Loading delivery logs...</span>
              </div>
            ) : outreachHistory.length === 0 ? (
              <div className="p-3 rounded-lg bg-slate-50 border border-dashed border-slate-200 text-center">
                <p className="text-[11.5px] text-slate-500">
                  No automated outreach records found for this lead.
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Click &quot;Send Outreach&quot; above to preview grounded copy and transmit live.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                {outreachHistory.map((item) => {
                  const isSuccess = item.status === 'SENT' || item.status === 'DELIVERED' || item.status === 'READ';
                  const isPending = item.status === 'QUEUED' || item.status === 'SENDING' || item.status === 'PENDING';
                  const isSuppressed = item.status === 'SUPPRESSED';

                  const badgeClass = isSuccess
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : isPending
                    ? 'bg-blue-50 text-blue-700 border-blue-200'
                    : isSuppressed
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-rose-50 text-rose-700 border-rose-200';

                  return (
                    <div
                      key={item.id}
                      className="p-3 rounded-lg border border-slate-100 bg-[#F8FAFC] text-[12px] space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          {item.channel === 'EMAIL' ? (
                            <Mail className="h-3.5 w-3.5 text-slate-600" />
                          ) : item.channel === 'SMS' ? (
                            <Phone className="h-3.5 w-3.5 text-slate-600" />
                          ) : (
                            <MessageSquare className="h-3.5 w-3.5 text-emerald-600" />
                          )}
                          <span className="font-semibold text-slate-800">{item.channel}</span>
                          <span className="text-slate-400">•</span>
                          <span className="text-slate-600 truncate max-w-[150px] font-mono text-[11px]">
                            {item.recipient}
                          </span>
                        </div>

                        <span className={`px-2 py-0.5 rounded text-[10.5px] font-bold border ${badgeClass}`}>
                          {item.status}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-slate-500 pt-0.5">
                        <span>Provider: <strong className="text-slate-700 font-mono">{item.provider}</strong></span>
                        <span>
                          {new Date(item.createdAt).toLocaleDateString()} {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>

                      {item.errorMessage && (
                        <div className="p-2 rounded bg-rose-50 border border-rose-200 text-rose-700 text-[11px] flex items-start gap-1.5 mt-1">
                          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          <span className="break-all">{item.errorMessage}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Real Outreach Preview & Live Execution Modal */}
      {isPreviewModalOpen && previewData && (
        <div className="fixed inset-0 z-70 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="p-4 px-6 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div>
                <h3 className="text-[15px] font-bold text-slate-900 flex items-center gap-2">
                  <Send className="h-4 w-4 text-teal-600" />
                  Live Automated Outreach: {lead.businessName}
                </h3>
                <p className="text-[11.5px] text-slate-500 mt-0.5">
                  Verified claims strictly grounded in actual audit diagnostics.
                </p>
              </div>
              <button
                onClick={() => setIsPreviewModalOpen(false)}
                className="h-8 w-8 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-200 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 space-y-4 overflow-y-auto">
              {/* Channel Selector Tabs */}
              <div>
                <label className="text-[11.5px] font-bold text-slate-700 uppercase tracking-wider block mb-1.5">
                  Select Outreach Channel
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['EMAIL', 'SMS', 'WHATSAPP'] as const).map((ch) => {
                    const isSelected = selectedChannel === ch;
                    const chEligibility =
                      ch === 'EMAIL'
                        ? previewData.eligibility?.email
                        : ch === 'SMS'
                        ? previewData.eligibility?.sms
                        : previewData.eligibility?.whatsapp;

                    const isEligible = chEligibility?.eligible;

                    return (
                      <button
                        key={ch}
                        type="button"
                        onClick={() => handleSelectChannel(ch)}
                        className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                          isSelected
                            ? 'border-teal-600 bg-teal-50/60 ring-2 ring-teal-500/20'
                            : 'border-slate-200 bg-white hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <div className="flex items-center gap-1.5 font-bold text-[12px] text-slate-900">
                            {ch === 'EMAIL' ? (
                              <Mail className="h-3.5 w-3.5 text-teal-600" />
                            ) : ch === 'SMS' ? (
                              <Phone className="h-3.5 w-3.5 text-indigo-600" />
                            ) : (
                              <MessageSquare className="h-3.5 w-3.5 text-emerald-600" />
                            )}
                            <span>{ch}</span>
                          </div>
                          <span
                            className={`h-2 w-2 rounded-full ${
                              isEligible ? 'bg-emerald-500' : 'bg-rose-400'
                            }`}
                            title={isEligible ? 'Channel Eligible' : chEligibility?.reason || 'Ineligible'}
                          />
                        </div>

                        <div className="mt-2 text-[10.5px] truncate text-slate-600 font-mono">
                          {chEligibility?.recipient || 'No contact info'}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Grounded Evidence Claims Badge Box */}
              {previewData.generated?.evidenceUsed && previewData.generated.evidenceUsed.length > 0 && (
                <div className="p-3.5 rounded-xl bg-teal-50/50 border border-teal-200 space-y-2">
                  <div className="flex items-center gap-1.5 text-[11.5px] font-bold text-teal-900">
                    <ShieldCheck className="h-3.5 w-3.5 text-teal-600" />
                    <span>Verified Technical Audit Evidence Used in Pitch:</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {previewData.generated.evidenceUsed.map((evidence: string, idx: number) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 rounded-md bg-white border border-teal-200 text-teal-800 text-[11px] font-medium shadow-2xs"
                      >
                        ✓ {evidence}
                      </span>
                    ))}
                  </div>
                  <p className="text-[10.5px] text-teal-700">
                    Zero fabricated claims. This pitch only references problems verified by your crawler.
                  </p>
                </div>
              )}

              {/* Message Content Inputs */}
              <div className="space-y-3">
                {selectedChannel === 'EMAIL' && (
                  <div>
                    <label className="text-[11.5px] font-bold text-slate-700 block mb-1">
                      Email Subject
                    </label>
                    <input
                      type="text"
                      value={modalSubject}
                      onChange={(e) => setModalSubject(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 p-2 text-[12.5px] text-slate-900 focus:outline-none focus:border-teal-600"
                    />
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11.5px] font-bold text-slate-700">
                      Message Body ({selectedChannel})
                    </label>
                    <span className="text-[10.5px] text-slate-400">
                      {modalBody.length} characters
                    </span>
                  </div>
                  <textarea
                    value={modalBody}
                    onChange={(e) => setModalBody(e.target.value)}
                    rows={selectedChannel === 'EMAIL' ? 7 : 4}
                    className="w-full rounded-lg border border-slate-300 p-2.5 text-[12px] text-slate-900 font-sans focus:outline-none focus:border-teal-600"
                  />
                </div>
              </div>

              {/* Provider Readiness & Eligibility Banner */}
              {(() => {
                const currentEligibility =
                  selectedChannel === 'EMAIL'
                    ? previewData.eligibility?.email
                    : selectedChannel === 'SMS'
                    ? previewData.eligibility?.sms
                    : previewData.eligibility?.whatsapp;

                if (!currentEligibility?.eligible) {
                  return (
                    <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-[11.5px] flex items-start gap-2">
                      <ShieldAlert className="h-4 w-4 text-rose-600 mt-0.5 shrink-0" />
                      <div>
                        <strong className="block font-semibold">Channel Ineligible</strong>
                        <span>{currentEligibility?.reason || 'This channel cannot be reached for this lead.'}</span>
                      </div>
                    </div>
                  );
                }

                if (!currentEligibility.providerConfigured) {
                  return (
                    <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[11.5px] flex items-start gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                      <div>
                        <strong className="block font-semibold">
                          Provider Not Configured ({currentEligibility.providerName})
                        </strong>
                        <span>
                          Live credentials (API key) for this provider are missing in your .env. In accordance with LeadPilot&apos;s real data policy, no mock delivery will occur. Sending now will record the attempt as FAILED with an explicit provider configuration error.
                        </span>
                      </div>
                    </div>
                  );
                }

                return (
                  <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11.5px] flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span>
                      Live Provider Active: Ready to transmit to <strong>{currentEligibility.recipient}</strong> via <strong>{currentEligibility.providerName}</strong>.
                    </span>
                  </div>
                );
              })()}
            </div>

            {/* Modal Footer */}
            <div className="p-4 px-6 border-t border-slate-200 flex items-center justify-between bg-slate-50">
              <a
                href={`/api/outreach/export?leadId=${lead.id}`}
                download
                className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-slate-600 hover:text-slate-900"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Download Report (.xlsx)</span>
              </a>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsPreviewModalOpen(false)}
                  className="px-3.5 py-2 rounded-xl border border-slate-300 text-slate-700 text-[12px] font-medium hover:bg-slate-100 cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={handleExecuteLiveSend}
                  disabled={
                    isSendingLive ||
                    !(
                      selectedChannel === 'EMAIL'
                        ? previewData.eligibility?.email?.eligible
                        : selectedChannel === 'SMS'
                        ? previewData.eligibility?.sms?.eligible
                        : previewData.eligibility?.whatsapp?.eligible
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-[12px] font-bold shadow-sm transition-colors cursor-pointer"
                >
                  {isSendingLive ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Transmitting...</span>
                    </>
                  ) : (
                    <>
                      <Send className="h-3.5 w-3.5" />
                      <span>Transmit Outreach</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Clean Demo Preview Modal */}
      {previewDemoOpen && (
        <div className="fixed inset-0 z-60 bg-black/50 flex items-center justify-center p-4 animate-fade-in">
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-rose-400" />
                <div className="h-3 w-3 rounded-full bg-amber-400" />
                <div className="h-3 w-3 rounded-full bg-emerald-400" />
                <span className="text-[12px] font-medium text-slate-600 ml-2">
                  demo.leadpilot.ai/{lead.businessName.toLowerCase().replace(/[^a-z0-9]/g, '-')}
                </span>
              </div>
              <button
                onClick={() => setPreviewDemoOpen(false)}
                className="h-7 w-7 rounded-lg text-slate-400 hover:text-slate-800 flex items-center justify-center"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="h-40 rounded-xl bg-slate-900 text-white p-6 flex flex-col justify-center">
                <span className="text-teal-400 text-xs font-semibold uppercase tracking-wider">
                  {lead.industry} Demo Prototype
                </span>
                <h3 className="text-xl font-bold mt-1">
                  {lead.businessName}
                </h3>
                <p className="text-sm text-slate-300 mt-1">
                  Fast mobile reservation & high-converting client portal.
                </p>
                <div className="mt-4 flex gap-2">
                  <span className="px-3 py-1 rounded bg-teal-600 text-white text-xs font-medium">
                    Book Online Now
                  </span>
                  <span className="px-3 py-1 rounded bg-slate-800 text-slate-300 text-xs font-medium">
                    View Services
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-slate-500 pt-2">
                <span>Speed Benchmark: 98/100 Mobile Score</span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(`https://demo.leadpilot.ai/${lead.businessName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`);
                    onShowToast('Demo Link Copied', 'Shareable prototype URL copied to clipboard.', 'success');
                  }}
                  className="text-teal-700 font-semibold hover:underline"
                >
                  Copy Shareable Link
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
