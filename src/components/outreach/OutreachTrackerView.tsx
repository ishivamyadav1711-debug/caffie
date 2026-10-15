'use client';

import React, { useState, useEffect } from 'react';
import {
  Mail,
  RefreshCw,
  Search,
  Filter,
  CheckCircle2,
  AlertCircle,
  Clock,
  MessageSquare,
  AlertTriangle,
  ExternalLink,
  ChevronDown,
  Send,
} from 'lucide-react';

interface OutreachRecord {
  id: string;
  leadId: string;
  businessName: string;
  channel: string;
  recipient: string;
  senderEmail: string;
  senderDisplayName?: string;
  subject: string;
  message: string;
  status: string;
  replyStatus: 'Replied' | 'No Reply' | 'N/A';
  repliesCount: number;
  latestReply?: {
    id: string;
    classification: string;
    receivedAt: string;
    subject: string;
    fromEmail: string;
  };
  provider: string;
  providerMessageId?: string;
  gmailMessageId?: string;
  gmailThreadId?: string;
  errorCode?: string;
  errorMessage?: string;
  sentAt?: string;
  deliveredAt?: string;
  createdAt: string;
}

export const OutreachTrackerView: React.FC = () => {
  const [filter, setFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [outreaches, setOutreaches] = useState<OutreachRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingReplies, setSyncingReplies] = useState(false);
  const [sendingNextBatch, setSendingNextBatch] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  const fetchOutreach = async () => {
    try {
      setLoading(true);
      const url = new URL('/api/outreach/history', window.location.origin);
      if (filter !== 'ALL') url.searchParams.set('filter', filter);
      const res = await fetch(url.toString());
      const data = await res.json();
      if (data.success) {
        setOutreaches(data.outreaches || []);
      }
    } catch (err: any) {
      console.error('Error fetching outreach history:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOutreach();
  }, [filter]);

  const handleSyncReplies = async () => {
    try {
      setSyncingReplies(true);
      setSyncNotice(null);
      const res = await fetch('/api/outreach/sync-replies', {
        method: 'POST',
      });
      const data = await res.json();
      if (data.success) {
        setSyncNotice(
          `Sync complete: checked ${data.threadsChecked} Gmail thread(s), discovered ${data.newRepliesCount} new reply(s).`
        );
        await fetchOutreach();
      } else {
        setSyncNotice(`Sync notice: ${data.error || 'No updates'}`);
      }
    } catch (err: any) {
      setSyncNotice(`Reply sync error: ${err.message}`);
    } finally {
      setSyncingReplies(false);
    }
  };

  const handleSendNextBatch = async () => {
    const queuedCount = outreaches.filter((o) => o.status === 'QUEUED').length;
    const confirmMsg = `Send the next batch of queued leads?\n\nThe system will recalculate sender health, domain capacity, suppression, and recipient eligibility before dispatching.`;
    if (!window.confirm(confirmMsg)) return;

    try {
      setSendingNextBatch(true);
      setSyncNotice(null);
      const res = await fetch('/api/outreach/send-next-batch', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to dispatch next batch.');
      }
      setSyncNotice(data.message || 'Dispatched next batch successfully.');
      await fetchOutreach();
    } catch (err: any) {
      setSyncNotice(`Batch dispatch error: ${err.message}`);
    } finally {
      setSendingNextBatch(false);
    }
  };

  const queuedTotal = outreaches.filter((o) => o.status === 'QUEUED').length;

  const filtered = outreaches.filter((o) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      o.businessName.toLowerCase().includes(query) ||
      o.recipient.toLowerCase().includes(query) ||
      o.senderEmail.toLowerCase().includes(query) ||
      (o.subject && o.subject.toLowerCase().includes(query))
    );
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'SENT':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
            <CheckCircle2 className="w-3 h-3" />
            SENT
          </span>
        );
      case 'QUEUED':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
            <Clock className="w-3 h-3" />
            QUEUED
          </span>
        );
      case 'FAILED':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700 bg-rose-100 px-2 py-0.5 rounded-full">
            <AlertCircle className="w-3 h-3" />
            FAILED
          </span>
        );
      case 'BOUNCED':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-700 bg-red-100 px-2 py-0.5 rounded-full">
            <AlertTriangle className="w-3 h-3" />
            BOUNCED
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">
            {status}
          </span>
        );
    }
  };

  const filterTabs = [
    { key: 'ALL', label: 'All' },
    { key: 'SENT', label: 'Sent' },
    { key: 'QUEUED', label: 'Queued' },
    { key: 'FAILED', label: 'Failed' },
    { key: 'BOUNCED', label: 'Bounced' },
    { key: 'REPLIED', label: 'Replied' },
    { key: 'NO_REPLY', label: 'No Reply' },
  ];

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-6 bg-white rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Mail className="w-5 h-5 text-teal-600" />
            Outreach History & Tracking
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Real-time audit log of who was emailed, sender mailbox used, submission status, and Gmail reply synchronization.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {queuedTotal > 0 && (
            <button
              onClick={handleSendNextBatch}
              disabled={sendingNextBatch}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-bold text-white bg-teal-600 hover:bg-teal-700 rounded-xl transition-colors shadow-xs disabled:opacity-50"
            >
              <Send className={`w-3.5 h-3.5 ${sendingNextBatch ? 'animate-spin' : ''}`} />
              {sendingNextBatch ? 'Dispatching...' : `Send Next Batch (${queuedTotal} Queued)`}
            </button>
          )}

          <button
            onClick={handleSyncReplies}
            disabled={syncingReplies}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-xl transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncingReplies ? 'animate-spin' : ''}`} />
            {syncingReplies ? 'Checking Gmail...' : 'Sync Gmail Replies'}
          </button>

          <button
            onClick={() => fetchOutreach()}
            disabled={loading}
            className="p-2 text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
            title="Refresh Table"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {syncNotice && (
        <div className="p-3 bg-blue-50 border border-blue-200 text-blue-900 rounded-xl text-xs flex items-center justify-between">
          <span>{syncNotice}</span>
          <button
            onClick={() => setSyncNotice(null)}
            className="text-blue-500 hover:text-blue-700 font-bold ml-2"
          >
            ×
          </button>
        </div>
      )}

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
          {filterTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                filter === tab.key
                  ? 'bg-teal-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search business or recipient..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full text-xs pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-teal-500"
          />
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-500 text-sm">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-teal-600" />
            Loading outreach history...
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-500 text-sm">
            <Mail className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            No outreach records found for this filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  <th className="px-5 py-3">Business</th>
                  <th className="px-4 py-3">Recipient</th>
                  <th className="px-4 py-3">Sender Mailbox</th>
                  <th className="px-4 py-3">Subject</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Reply Status</th>
                  <th className="px-4 py-3">Sent Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filtered.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-5 py-3 font-semibold text-slate-900">
                      {o.businessName}
                    </td>

                    <td className="px-4 py-3 text-slate-600 font-mono">
                      {o.recipient}
                    </td>

                    <td className="px-4 py-3 text-teal-700 font-medium">
                      {o.senderEmail}
                    </td>

                    <td className="px-4 py-3 text-slate-700 max-w-[200px] truncate" title={o.subject}>
                      {o.subject || '—'}
                    </td>

                    <td className="px-4 py-3">
                      {getStatusBadge(o.status)}
                      {o.errorMessage && (
                        <div className="text-[10px] text-rose-600 mt-0.5 truncate max-w-[150px]" title={o.errorMessage}>
                          {o.errorMessage}
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      {o.replyStatus === 'Replied' ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-200">
                          <MessageSquare className="w-3 h-3 text-indigo-600" />
                          Replied
                        </span>
                      ) : o.replyStatus === 'No Reply' ? (
                        <span className="text-slate-400">No Reply</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>

                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                      {o.sentAt
                        ? new Date(o.sentAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
                        : o.createdAt
                        ? new Date(o.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
