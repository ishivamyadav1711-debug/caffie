'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  Mail,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Send,
  Edit2,
  Check,
  RefreshCw,
  AlertCircle,
  ExternalLink,
  ChevronRight,
  Info,
} from 'lucide-react';
import { Lead } from '@/types';
import { BulkPreparationResult, BulkOutreachLeadItem, BulkExecutionResult } from '@/lib/outreach/bulkOutreachService';

interface BulkAIOutreachModalProps {
  bulkLeads: Lead[];
  onClose: () => void;
  onSuccess?: () => void;
}

export const BulkAIOutreachModal: React.FC<BulkAIOutreachModalProps> = ({
  bulkLeads,
  onClose,
  onSuccess,
}) => {
  const [step, setStep] = useState<'PREPARING' | 'REVIEW' | 'SENDING' | 'COMPLETED'>('PREPARING');
  const [preparation, setPreparation] = useState<BulkPreparationResult | null>(null);
  const [items, setItems] = useState<BulkOutreachLeadItem[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');
  const [prepError, setPrepError] = useState<string | null>(null);
  const [executionResult, setExecutionResult] = useState<BulkExecutionResult | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  // Load and prepare on modal open
  useEffect(() => {
    let isMounted = true;
    const prepare = async () => {
      try {
        setStep('PREPARING');
        setPrepError(null);
        const leadIds = bulkLeads.map((l) => l.id);

        const res = await fetch('/api/outreach/bulk-prepare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leadIds }),
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed to prepare bulk outreach.');
        }

        if (isMounted) {
          setPreparation(data);
          setItems(data.items || []);
          setStep('REVIEW');
        }
      } catch (err: any) {
        if (isMounted) {
          setPrepError(err.message || 'Error preparing outreach.');
        }
      }
    };

    prepare();
    return () => {
      isMounted = false;
    };
  }, [bulkLeads]);

  // Handle lead skip toggle
  const toggleSkipLead = (index: number) => {
    setItems((prev) => {
      const copy = [...prev];
      const target = copy[index];
      if (target.status === 'READY') {
        target.status = 'SKIPPED';
        target.skipReasonMessage = 'Manually excluded by user during review.';
      } else if (target.status === 'SKIPPED' && !target.skipReasonCode) {
        target.status = 'READY';
        target.skipReasonMessage = undefined;
      }
      return copy;
    });
  };

  // Start inline editing
  const handleStartEdit = (index: number) => {
    setEditingIndex(index);
    setEditSubject(items[index].subject);
    setEditBody(items[index].bodyText);
  };

  // Save inline edits
  const handleSaveEdit = (index: number) => {
    setItems((prev) => {
      const copy = [...prev];
      copy[index].subject = editSubject;
      copy[index].bodyText = editBody;
      return copy;
    });
    setEditingIndex(null);
  };

  // Explicit user confirmation to execute sending
  const handleExecuteSend = async () => {
    const readyItems = items.filter((i) => i.status === 'READY');
    const queuedItems = items.filter((i) => i.status === 'QUEUED');

    if (readyItems.length === 0 && queuedItems.length === 0) {
      alert('No leads are ready to send or queue.');
      return;
    }

    const confirmMsg = `Confirm controlled sending for ${readyItems.length} ready lead(s)${
      queuedItems.length > 0 ? ` and queueing ${queuedItems.length} lead(s)` : ''
    }?\n\nEmails are transmitted via your genuine authorized Gmail/Google Workspace mailboxes.`;
    if (!window.confirm(confirmMsg)) return;

    try {
      setStep('SENDING');
      setSendError(null);

      const approvedPayload = [
        ...readyItems.map((item) => ({
          leadId: item.leadId,
          recipientEmail: item.recipientEmail,
          senderAccountId: item.senderAccountId!,
          subject: item.subject,
          bodyText: item.bodyText,
          bodyHtml: item.bodyHtml,
          evidenceUsed: item.evidenceUsed,
          status: 'READY' as const,
        })),
        ...queuedItems.map((item) => ({
          leadId: item.leadId,
          recipientEmail: item.recipientEmail,
          senderAccountId: item.senderAccountId || '',
          subject: item.subject,
          bodyText: item.bodyText,
          bodyHtml: item.bodyHtml,
          evidenceUsed: item.evidenceUsed,
          status: 'QUEUED' as const,
        })),
      ];

      const res = await fetch('/api/outreach/bulk-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvedItems: approvedPayload }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to complete sending process.');
      }

      setExecutionResult(data);
      setStep('COMPLETED');
      if (onSuccess) onSuccess();
    } catch (err: any) {
      setSendError(err.message || 'Execution error during outreach send.');
      setStep('REVIEW');
    }
  };

  const readyCount = items.filter((i) => i.status === 'READY').length;
  const queuedCount = items.filter((i) => i.status === 'QUEUED').length;
  const skippedCount = items.filter((i) => i.status === 'SKIPPED').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200/80 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in-50 zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-700">
              <Mail className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Controlled Multi-Sender AI Outreach
              </h2>
              <p className="text-xs text-slate-500">
                {bulkLeads.length} leads selected · Evidence-based personalization & safety gate
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Reputation & Safety Banner */}
        <div className="px-6 py-2.5 bg-blue-50/70 border-b border-blue-100/70 text-xs text-blue-900 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0" />
            <span>
              <strong>Controlled Sending:</strong> Prioritizes sender reputation, recipient quality, and Gmail policy compliance. No system can guarantee inbox delivery.
            </span>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* STEP 1: PREPARING */}
          {step === 'PREPARING' && (
            <div className="py-16 text-center space-y-4">
              <RefreshCw className="w-10 h-10 text-teal-600 animate-spin mx-auto" />
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Evaluating Safety Gate & Generating Messages...
                </h3>
                <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                  Validating recipient syntax, checking suppression & duplicate locks, grounding messages in genuine database evidence, and allocating sender mailboxes.
                </p>
              </div>
              {prepError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs max-w-md mx-auto">
                  {prepError}
                </div>
              )}
            </div>
          )}

          {/* STEP 2: REVIEW */}
          {step === 'REVIEW' && (
            <div className="space-y-5">
              {sendError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{sendError}</span>
                </div>
              )}

              {/* Capacity & Allocation Summary (500-Lead Campaign Behavior) */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl">
                  <div className="text-[11px] font-semibold text-slate-500 uppercase">Selected</div>
                  <div className="text-xl font-bold text-slate-900 mt-0.5">{items.length}</div>
                </div>

                <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl">
                  <div className="text-[11px] font-semibold text-slate-600 uppercase">Eligible</div>
                  <div className="text-xl font-bold text-slate-900 mt-0.5">{readyCount + queuedCount}</div>
                </div>

                <div className="p-3 bg-slate-100 border border-slate-200 rounded-xl">
                  <div className="text-[11px] font-semibold text-slate-500 uppercase">Skipped</div>
                  <div className="text-xl font-bold text-slate-600 mt-0.5">{skippedCount}</div>
                </div>

                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
                  <div className="text-[11px] font-semibold text-amber-800 uppercase">Safe Capacity</div>
                  <div className="text-xl font-bold text-amber-900 mt-0.5">
                    {preparation?.senderPoolSummary?.totalAvailableCapacity ?? 0}
                  </div>
                </div>

                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                  <div className="text-[11px] font-semibold text-emerald-700 uppercase">Ready To Send</div>
                  <div className="text-xl font-bold text-emerald-800 mt-0.5">{readyCount}</div>
                </div>

                <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl">
                  <div className="text-[11px] font-semibold text-blue-700 uppercase">Queued</div>
                  <div className="text-xl font-bold text-blue-800 mt-0.5">{queuedCount}</div>
                </div>
              </div>

              {preparation?.senderPoolSummary && (
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/70 text-xs text-slate-600 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <strong>Sender Pool:</strong> {preparation.senderPoolSummary.connectedSendersCount} mailbox(es) connected · {preparation.senderPoolSummary.totalAvailableCapacity} safe capacity remaining today.
                  </div>
                  <div className="text-[11px] font-medium text-slate-500">
                    Target: {preparation.senderPoolSummary.targetDailyCapacity || 500}/day · Limit: {preparation.senderPoolSummary.maxTotalDailyOutreach || 100}/day
                  </div>
                </div>
              )}

              {/* Dynamic Sender Allocation Plan */}
              {preparation?.allocationPlan && preparation.allocationPlan.allocations.length > 0 && (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                      Estimated Dynamic Sender Allocation
                    </span>
                    {preparation.allocationPlan.redistributedCount > 0 && (
                      <span className="text-[11px] font-semibold text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full border border-teal-200">
                        {preparation.allocationPlan.redistributedCount} workload redistributed to healthy senders
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {preparation.allocationPlan.allocations.map((alloc) => (
                      <div
                        key={alloc.senderAccountId}
                        className="p-2.5 bg-white border border-slate-200/80 rounded-lg flex items-center justify-between text-xs"
                      >
                        <div className="truncate pr-2">
                          <span className="font-semibold text-slate-800 block truncate">
                            {alloc.senderEmail}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">
                            Health: {alloc.healthScore}/100
                          </span>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="font-bold text-teal-700 text-sm">{alloc.capacityAllocated}</span>
                          <span
                            className={`text-[10px] font-semibold block uppercase ${
                              alloc.healthState === 'HEALTHY'
                                ? 'text-emerald-600'
                                : alloc.healthState === 'WARNING'
                                ? 'text-amber-600'
                                : 'text-rose-600'
                            }`}
                          >
                            {alloc.healthState}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Items Review Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
                  {items.map((item, idx) => (
                    <div key={idx} className="p-4 hover:bg-slate-50/50 transition-colors">
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1 flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-slate-900 truncate">
                              {item.businessName}
                            </span>
                            <span className="text-xs text-slate-500">
                              · {item.recipientEmail}
                            </span>

                            {/* Status badge */}
                            {item.status === 'READY' && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                                <CheckCircle2 className="w-3 h-3" />
                                READY
                              </span>
                            )}
                            {item.status === 'QUEUED' && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
                                <Clock className="w-3 h-3" />
                                QUEUED
                              </span>
                            )}
                            {item.status === 'SKIPPED' && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 bg-slate-200 px-2 py-0.5 rounded-full">
                                <AlertTriangle className="w-3 h-3 text-slate-500" />
                                SKIPPED
                              </span>
                            )}
                          </div>

                          {/* Sender mailbox assigned */}
                          {item.senderEmail && item.status === 'READY' && (
                            <div className="text-xs text-teal-700 font-medium flex items-center gap-1">
                              <Mail className="w-3 h-3" />
                              From: {item.senderEmail}
                            </div>
                          )}

                          {/* Skip Reason Note */}
                          {item.skipReasonMessage && (
                            <div className="text-xs text-amber-700 bg-amber-50 p-2 rounded-lg border border-amber-200 mt-1">
                              {item.skipReasonMessage}
                            </div>
                          )}

                          {/* Inline Editing or Preview */}
                          {editingIndex === idx ? (
                            <div className="space-y-2 pt-2">
                              <input
                                type="text"
                                value={editSubject}
                                onChange={(e) => setEditSubject(e.target.value)}
                                className="w-full text-xs font-medium px-3 py-1.5 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-teal-500"
                                placeholder="Subject"
                              />
                              <textarea
                                value={editBody}
                                onChange={(e) => setEditBody(e.target.value)}
                                rows={4}
                                className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-teal-500 font-sans"
                                placeholder="Email message body"
                              />
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => handleSaveEdit(idx)}
                                  className="text-xs font-semibold px-3 py-1 bg-teal-600 text-white rounded-md hover:bg-teal-700"
                                >
                                  Save Changes
                                </button>
                                <button
                                  onClick={() => setEditingIndex(null)}
                                  className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : item.status !== 'SKIPPED' && (
                            <div className="pt-1 text-xs text-slate-600 space-y-1">
                              <div className="font-semibold text-slate-800">
                                Subject: {item.subject}
                              </div>
                              <p className="line-clamp-2 text-slate-500">
                                {item.bodyText}
                              </p>
                              {item.evidenceUsed && item.evidenceUsed.length > 0 && (
                                <div className="flex flex-wrap gap-1 pt-1">
                                  {item.evidenceUsed.map((ev, eIdx) => (
                                    <span
                                      key={eIdx}
                                      className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200"
                                    >
                                      {ev}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          {editingIndex !== idx && item.status !== 'SKIPPED' && (
                            <button
                              onClick={() => handleStartEdit(idx)}
                              className="p-1.5 text-slate-400 hover:text-slate-600 rounded hover:bg-slate-100 transition-colors"
                              title="Edit Subject & Body"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => toggleSkipLead(idx)}
                            className={`px-2 py-1 text-xs rounded transition-colors ${
                              item.status === 'SKIPPED'
                                ? 'text-teal-700 bg-teal-50 hover:bg-teal-100'
                                : 'text-slate-500 hover:text-red-700 hover:bg-red-50'
                            }`}
                          >
                            {item.status === 'SKIPPED' ? 'Include' : 'Skip'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: SENDING */}
          {step === 'SENDING' && (
            <div className="py-16 text-center space-y-4">
              <RefreshCw className="w-10 h-10 text-teal-600 animate-spin mx-auto" />
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Sending Through Authorized Mailboxes...
                </h3>
                <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                  Executing bounded concurrency sends via Gmail API. Storing messageId & threadId upon submission.
                </p>
              </div>
            </div>
          )}

          {/* STEP 4: COMPLETED */}
          {step === 'COMPLETED' && executionResult && (
            <div className="space-y-5">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  <div>
                    <span className="font-bold text-sm block">Outreach Batch Complete</span>
                    <span className="text-xs">
                      {executionResult.sentCount} sent · {executionResult.queuedCount} queued · {executionResult.failedCount} failed
                    </span>
                  </div>
                </div>
              </div>

              {/* Execution Outcomes Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 text-xs">
                  {executionResult.outcomes.map((out, idx) => (
                    <div key={idx} className="p-3 flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-800">{out.recipientEmail}</span>
                          <span className="text-[10px] text-slate-400">
                            {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </span>
                        </div>
                        {out.senderEmail && (
                          <span className="text-slate-400 text-xs">via {out.senderEmail}</span>
                        )}
                        {out.gmailMessageId && (
                          <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                            Gmail ID: {out.gmailMessageId}
                            {out.gmailThreadId && ` · Thread: ${out.gmailThreadId}`}
                          </div>
                        )}
                        {out.errorMessage && (
                          <div className="text-[11px] text-rose-600 mt-0.5">
                            {out.errorMessage}
                          </div>
                        )}
                      </div>
                      <span className={`px-2 py-0.5 rounded-full font-semibold text-[11px] ${
                        out.status === 'SENT'
                          ? 'bg-emerald-100 text-emerald-800'
                          : out.status === 'QUEUED'
                          ? 'bg-blue-100 text-blue-800'
                          : out.status === 'BOUNCED'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}>
                        {out.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer with Explicit Action Buttons */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-xl hover:bg-slate-100 transition-colors"
          >
            {step === 'COMPLETED' ? 'Close' : 'Cancel'}
          </button>

          {step === 'REVIEW' && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-500 hidden sm:inline">
                Explicit user approval required to transmit
              </span>
              <button
                onClick={handleExecuteSend}
                disabled={readyCount === 0 && queuedCount === 0}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-teal-600 hover:bg-teal-700 rounded-xl shadow-xs transition-all active:scale-[0.98] disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                SEND ALL {readyCount}{queuedCount > 0 ? ` (QUEUE ${queuedCount})` : ''}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
