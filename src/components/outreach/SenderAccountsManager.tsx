'use client';

import React, { useState, useEffect } from 'react';
import {
  Mail,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Unlink,
  Plus,
  Server,
  Globe,
  Activity,
  Info,
  Sliders,
  Check,
  Search,
  Lock,
} from 'lucide-react';
import { SenderPoolResult } from '@/lib/senders/senderPoolService';
import { DnsVerificationResult } from '@/lib/senders/dnsVerificationService';

interface SenderAccountsManagerProps {
  onRefresh?: () => void;
}

export const SenderAccountsManager: React.FC<SenderAccountsManagerProps> = ({ onRefresh }) => {
  const [loading, setLoading] = useState(true);
  const [pool, setPool] = useState<SenderPoolResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  // Domains State
  const [domains, setDomains] = useState<any[]>([]);
  const [newDomainInput, setNewDomainInput] = useState('');
  const [domainsLoading, setDomainsLoading] = useState(false);
  const [actionDomainId, setActionDomainId] = useState<string | null>(null);
  const [dnsError, setDnsError] = useState<string | null>(null);

  // Admin Capacity Config State
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [configSubmitting, setConfigSubmitting] = useState(false);
  const [targetDailyCapacity, setTargetDailyCapacity] = useState(500);
  const [maxPerSender, setMaxPerSender] = useState(25);
  const [maxPerDomain, setMaxPerDomain] = useState(100);
  const [maxTotalDaily, setMaxTotalDaily] = useState(100);
  const [configSuccessNotice, setConfigSuccessNotice] = useState<string | null>(null);

  const fetchPool = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/senders');
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to fetch sender mailboxes.');
      }
      setPool(data.pool);

      setPool(data.pool);

      // Fetch domains
      setDomainsLoading(true);
      fetch('/api/domains')
        .then(res => res.json())
        .then(domainData => {
          if (domainData.success) {
            setDomains(domainData.domains);
          }
        })
        .finally(() => setDomainsLoading(false));

      // Prepopulate capacity configs from pool data
      if (data.pool?.capacityConfig) {
        setTargetDailyCapacity(data.pool.capacityConfig.targetDailyCapacity);
        setMaxPerSender(data.pool.capacityConfig.maxPerSenderPerDay);
        setMaxPerDomain(data.pool.capacityConfig.maxPerDomainPerDay);
        setMaxTotalDaily(data.pool.capacityConfig.maxTotalDailyOutreach);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load sender mailboxes.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPool();
  }, []);

  const handleDisconnect = async (id: string) => {
    if (!confirm('Are you sure you want to disconnect this sender mailbox?')) return;
    try {
      setActionLoadingId(id);
      const res = await fetch(`/api/senders/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'disconnect' }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.error || 'Failed to disconnect mailbox.');
      } else {
        await fetchPool();
        if (onRefresh) onRefresh();
      }
    } catch (err: any) {
      alert(err.message || 'Error disconnecting mailbox.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleReconnect = async (id: string) => {
    try {
      setActionLoadingId(id);
      const res = await fetch(`/api/senders/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reconnect' }),
      });
      const data = await res.json();
      if (data.needsOAuth) {
        window.location.href = '/api/auth/gmail';
      } else {
        await fetchPool();
      }
    } catch (err: any) {
      alert(err.message || 'Error reconnecting mailbox.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleAddDomain = async () => {
    if (!newDomainInput.trim()) return;
    try {
      setDomainsLoading(true);
      const res = await fetch('/api/domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: newDomainInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error);
      setNewDomainInput('');
      fetchPool();
    } catch (err: any) {
      setDnsError(err.message || 'Failed to add domain');
    } finally {
      setDomainsLoading(false);
    }
  };

  const handleRunDnsVerification = async (domainId: string, currentSelector: string = '') => {
    try {
      setActionDomainId(domainId);
      setDnsError(null);
      const selector = prompt('Enter DKIM Selector (e.g. google)', currentSelector) || '';
      const res = await fetch(`/api/domains/dns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domainId, dkimSelector: selector }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'DNS query failed');
      fetchPool();
    } catch (err: any) {
      setDnsError(err.message || 'Failed to perform DNS check.');
    } finally {
      setActionDomainId(null);
    }
  };

  const handleSaveCapacityConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setConfigSubmitting(true);
      setConfigSuccessNotice(null);

      const res = await fetch('/api/senders/capacity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetDailyCapacity,
          maxPerSenderPerDay: maxPerSender,
          maxPerDomainPerDay: maxPerDomain,
          maxTotalDailyOutreach: maxTotalDaily,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to update capacity limits.');
      }

      setConfigSuccessNotice('Capacity safety limits updated successfully.');
      await fetchPool();
      setTimeout(() => setShowConfigModal(false), 1200);
    } catch (err: any) {
      alert(err.message || 'Error updating capacity configuration.');
    } finally {
      setConfigSubmitting(false);
    }
  };

  const getHealthBadge = (health: string, score?: number) => {
    switch (health) {
      case 'HEALTHY':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            HEALTHY {score !== undefined ? `(${score}%)` : ''}
          </span>
        );
      case 'WARNING':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <AlertCircle className="w-3 h-3 text-amber-600" />
            WARNING (50% alloc)
          </span>
        );
      case 'RESTRICTED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-orange-50 text-orange-700 border border-orange-200">
            <AlertCircle className="w-3 h-3 text-orange-600" />
            RESTRICTED (20% alloc)
          </span>
        );
      case 'PAUSED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            <AlertCircle className="w-3 h-3 text-rose-600" />
            PAUSED (0% alloc)
          </span>
        );
      case 'LIMITED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
            <AlertCircle className="w-3 h-3 text-amber-600" />
            DAILY CAP
          </span>
        );
      case 'AUTH_REQUIRED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200">
            <AlertCircle className="w-3 h-3 text-rose-600" />
            AUTH REQUIRED
          </span>
        );
      case 'ERROR':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200">
            <AlertCircle className="w-3 h-3 text-red-600" />
            ERROR
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with Title and Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-6 bg-white rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Mail className="w-5 h-5 text-teal-600" />
            Company Sender Mailboxes & Capacity
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Authorize genuine Google Workspace / Gmail mailboxes under your domain to form a controlled outreach sender pool.
          </p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            onClick={() => setShowConfigModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors border border-slate-200"
          >
            <Sliders className="w-3.5 h-3.5" />
            Configure Limits
          </button>
          <button
            onClick={() => fetchPool()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-50"
            title="Refresh Pool"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <a
            href="/api/auth/gmail"
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-xl shadow-xs transition-all active:scale-[0.98]"
          >
            <Plus className="w-4 h-4" />
            Connect Gmail Account
          </a>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Target vs Configured Safety Capacity Comparison Banner */}
      {pool?.capacityConfig && (
        <div className="p-5 bg-gradient-to-r from-teal-900 via-slate-900 to-slate-900 text-white rounded-2xl shadow-sm border border-slate-800">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-wider font-semibold text-teal-300 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-teal-400" />
                Truthful Capacity Model
              </div>
              <div className="mt-1 flex items-baseline gap-3 flex-wrap">
                <span className="text-2xl font-extrabold text-white">
                  Target: {pool.capacityConfig.targetDailyCapacity}/day
                </span>
                <span className="text-sm font-medium text-teal-200">
                  Current Safe Limit: {pool.capacityConfig.maxTotalDailyOutreach}/day
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1 max-w-2xl leading-relaxed">
                500/day is a product business target, not a guarantee that Gmail will accept 500 messages/day. Safety limits remain conservative (100/day) and can only be deliberately raised after DNS verification and sender warmup.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="px-4 py-2 bg-slate-800/80 rounded-xl border border-slate-700 text-right">
                <div className="text-[11px] text-slate-400 uppercase font-bold">Mailbox Limit</div>
                <div className="text-sm font-bold text-white">{pool.capacityConfig.maxPerSenderPerDay} / day</div>
              </div>
              <div className="px-4 py-2 bg-slate-800/80 rounded-xl border border-slate-700 text-right">
                <div className="text-[11px] text-slate-400 uppercase font-bold">Domain Limit</div>
                <div className="text-sm font-bold text-white">{pool.capacityConfig.maxPerDomainPerDay} / day</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pool Capacity & Usage Summary Cards */}
      {pool && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 bg-white rounded-xl border border-slate-200/80 shadow-xs">
            <div className="flex items-center justify-between text-slate-500 text-xs font-semibold uppercase tracking-wider">
              <span>Mailboxes</span>
              <Mail className="w-4 h-4 text-teal-600" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900">{pool.connectedCount}</span>
              <span className="text-xs text-slate-500">connected</span>
            </div>
            <div className="text-xs text-slate-400 mt-1">
              {pool.senders.length} total authorized
            </div>
          </div>

          <div className="p-4 bg-white rounded-xl border border-slate-200/80 shadow-xs">
            <div className="flex items-center justify-between text-slate-500 text-xs font-semibold uppercase tracking-wider">
              <span>Today&apos;s Usage</span>
              <Activity className="w-4 h-4 text-blue-600" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900">{pool.totalTodaySent}</span>
              <span className="text-xs text-slate-500">/ {pool.capacityConfig.maxTotalDailyOutreach} capacity</span>
            </div>
            <div className="text-xs text-slate-400 mt-1">
              Reset at 00:00 UTC
            </div>
          </div>

          <div className="p-4 bg-white rounded-xl border border-slate-200/80 shadow-xs">
            <div className="flex items-center justify-between text-slate-500 text-xs font-semibold uppercase tracking-wider">
              <span>Remaining Today</span>
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-emerald-700">{pool.totalCapacity}</span>
              <span className="text-xs text-slate-500">emails available</span>
            </div>
            <div className="text-xs text-slate-400 mt-1">
              Bounded by domain & global limits
            </div>
          </div>

          <div className="p-4 bg-white rounded-xl border border-slate-200/80 shadow-xs">
            <div className="flex items-center justify-between text-slate-500 text-xs font-semibold uppercase tracking-wider">
              <span>Primary Domain</span>
              <Globe className="w-4 h-4 text-indigo-600" />
            </div>
            <div className="mt-2 flex items-baseline gap-1 truncate">
              <span className="text-lg font-bold text-slate-900 truncate">
                {pool.domainConsistency.primaryDomain || 'No senders'}
              </span>
            </div>
            <div className="text-xs text-slate-400 mt-1">
              {pool.domainStats.length} domain(s) in pool
            </div>
          </div>
        </div>
      )}

      {/* Senders Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
            Authorized Mailbox Pool
          </h3>
          <span className="text-xs text-slate-500">
            OAuth Access Tokens encrypted with AES-256-GCM
          </span>
        </div>

        {loading ? (
          <div className="p-8 text-center text-slate-500 text-sm">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-teal-600" />
            Loading sender mailboxes...
          </div>
        ) : !pool || pool.senders.length === 0 ? (
          <div className="p-12 text-center">
            <Mail className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h4 className="text-base font-semibold text-slate-900">No Sender Mailboxes Connected</h4>
            <p className="text-sm text-slate-500 max-w-md mx-auto mt-1 mb-4">
              Authorize company Google Workspace or Gmail mailboxes (e.g. sales1@company.com, sales2@company.com) to start controlled AI outreach.
            </p>
            <a
              href="/api/auth/gmail"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-xl"
            >
              <Plus className="w-4 h-4" />
              Connect First Gmail Account
            </a>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  <th className="px-6 py-3">Sender Mailbox</th>
                  <th className="px-4 py-3">Provider</th>
                  <th className="px-4 py-3">Health Status</th>
                  <th className="px-4 py-3">Today&apos;s Usage</th>
                  <th className="px-4 py-3">Safety Limit</th>
                  <th className="px-4 py-3">Last Used</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pool.senders.map((sender) => (
                  <tr key={sender.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-700 font-bold text-xs">
                          {sender.email.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-semibold text-slate-900">{sender.email}</div>
                          <div className="text-xs text-slate-400">
                            Domain: @{sender.domain}
                            {sender.displayName && ` · ${sender.displayName}`}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-4 text-xs font-medium text-slate-600">
                      <span className="capitalize">{sender.provider.replace('_', ' ')}</span>
                    </td>

                    <td className="px-4 py-4">
                      {getHealthBadge(sender.healthState || sender.health, sender.healthScore)}
                      {sender.lastError && (
                        <div className="text-[11px] text-rose-600 mt-1 truncate max-w-[180px]" title={sender.lastError}>
                          {sender.lastError}
                        </div>
                      )}
                      {(sender.hardBounces !== undefined || sender.apiFailures !== undefined) && (
                        <div className="text-[10px] text-slate-400 mt-1">
                          Bounces: {sender.hardBounces ?? 0} · Failures: {sender.apiFailures ?? 0}
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-4">
                      <div className="text-sm font-semibold text-slate-900">
                        {sender.todaySentCount}
                      </div>
                      <div className="text-xs text-slate-400">
                        {sender.remainingCapacity} safe capacity
                        {sender.effectiveCapacity !== undefined && sender.effectiveCapacity !== sender.remainingCapacity && (
                          <span className="block text-[10px] text-amber-600 font-medium">
                            {sender.effectiveCapacity} health-adjusted
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="px-4 py-4">
                      <span className="text-xs font-medium text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                        {sender.dailySafetyLimit}/day
                      </span>
                    </td>

                    <td className="px-4 py-4 text-xs text-slate-500">
                      {sender.lastUsedAt ? new Date(sender.lastUsedAt).toLocaleDateString() : 'Never'}
                    </td>

                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {sender.status !== 'CONNECTED' && (
                          <button
                            onClick={() => handleReconnect(sender.id)}
                            disabled={actionLoadingId === sender.id}
                            className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-900 bg-teal-50 hover:bg-teal-100 px-2.5 py-1.5 rounded-lg transition-colors"
                          >
                            <RefreshCw className="w-3 h-3" />
                            Reconnect
                          </button>
                        )}
                        <button
                          onClick={() => handleDisconnect(sender.id)}
                          disabled={actionLoadingId === sender.id}
                          className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-red-700 bg-slate-100 hover:bg-red-50 px-2.5 py-1.5 rounded-lg transition-colors"
                        >
                          <Unlink className="w-3 h-3" />
                          Disconnect
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Automated Domain Health & Postmaster Monitoring */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Server className="w-5 h-5 text-indigo-600" />
              Automated Domain Health & Postmaster
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Persistent tracking of SPF, DKIM, DMARC records and Google Postmaster metrics.
            </p>
          </div>
        </div>

        {/* Add Domain */}
        <div className="flex items-end gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200/70">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-semibold text-slate-700">Company Domain</label>
            <input
              type="text"
              value={newDomainInput}
              onChange={(e) => setNewDomainInput(e.target.value)}
              placeholder="e.g. company.com"
              className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-hidden focus:ring-1 focus:ring-teal-500"
            />
          </div>
          <div>
            <button
              onClick={handleAddDomain}
              disabled={domainsLoading || !newDomainInput}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Domain
            </button>
          </div>
        </div>

        {dnsError && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs">
            {dnsError}
          </div>
        )}

        {/* Domains List */}
        <div className="space-y-4">
          {domains.map((d: any) => (
            <div key={d.id} className="p-4 rounded-xl border bg-white border-slate-200 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <Globe className="w-5 h-5 text-slate-400" />
                  <span className="font-bold text-slate-900">{d.domain}</span>
                  {getHealthBadge(d.healthState)}
                </div>
                <div className="flex items-center gap-2">
                  {!d.postmasterConnected && (
                    <a
                      href="/api/auth/postmaster"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                    >
                      <Activity className="w-3.5 h-3.5" />
                      Connect Postmaster
                    </a>
                  )}
                  <button
                    onClick={() => handleRunDnsVerification(d.id, d.dkimSelector)}
                    disabled={actionDomainId === d.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <Search className={`w-3.5 h-3.5 ${actionDomainId === d.id ? 'animate-spin' : ''}`} />
                    Verify DNS
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[11px] font-bold text-slate-600">SPF</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${d.spfStatus === 'VERIFIED' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                      {d.spfStatus}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono truncate" title={d.spfRecord || 'Not verified'}>{d.spfRecord || 'No record'}</div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[11px] font-bold text-slate-600">DKIM ({d.dkimSelector || 'N/A'})</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${d.dkimStatus === 'VERIFIED' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                      {d.dkimStatus}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono truncate" title={d.dkimRecord || 'Not verified'}>{d.dkimRecord || 'No record'}</div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[11px] font-bold text-slate-600">DMARC</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${d.dmarcStatus === 'VERIFIED' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                      {d.dmarcStatus}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono truncate" title={d.dmarcRecord || 'Not verified'}>{d.dmarcRecord || 'No record'}</div>
                </div>
              </div>

              {d.postmasterConnected && (
                <div className="mt-3 p-3 bg-blue-50/50 border border-blue-100 rounded-lg flex items-center gap-4 text-xs">
                  <div className="flex items-center gap-1.5 text-blue-700 font-semibold">
                    <Activity className="w-4 h-4" />
                    Postmaster Active
                  </div>
                  <div className="text-slate-500">
                    Spam Rate: <span className="font-bold text-slate-900">{d.spamRate ?? '0.00%'}</span>
                  </div>
                  <div className="text-slate-500">
                    Reputation: <span className="font-bold text-slate-900">{d.domainReputation ?? 'HIGH'}</span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="p-3 bg-blue-50/60 border border-blue-100 rounded-xl text-xs text-blue-900 flex items-start gap-2.5">
          <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">Reputation Integrity Policy:</span> LeadPilot strictly avoids IP rotation, domain throwaways, and artificial header manipulation. Genuine company domains with verified SPF/DKIM/DMARC maintain the highest organic deliverability.
          </div>
        </div>
      </div>

      {/* Admin Capacity Configuration Modal */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in fade-in-50 zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-teal-600" />
                <h3 className="text-sm font-bold text-slate-900">Administrator Capacity Configuration</h3>
              </div>
              <button
                onClick={() => setShowConfigModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSaveCapacityConfig} className="p-6 space-y-4">
              {configSuccessNotice && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-600" />
                  <span>{configSuccessNotice}</span>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">Target Daily Capacity (Business Target)</label>
                <input
                  type="number"
                  min={1}
                  max={2000}
                  value={targetDailyCapacity}
                  onChange={(e) => setTargetDailyCapacity(parseInt(e.target.value, 10) || 500)}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-teal-500"
                />
                <span className="text-[11px] text-slate-400 block">
                  Product capacity objective (e.g. 500/day). Does not bypass safety limits.
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Max Per Mailbox / Day</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={maxPerSender}
                    onChange={(e) => setMaxPerSender(parseInt(e.target.value, 10) || 25)}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-teal-500"
                  />
                  <span className="text-[11px] text-slate-400 block">Conservative default: 25</span>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Max Per Domain / Day</label>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={maxPerDomain}
                    onChange={(e) => setMaxPerDomain(parseInt(e.target.value, 10) || 100)}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-teal-500"
                  />
                  <span className="text-[11px] text-slate-400 block">Conservative default: 100</span>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">Current Max Daily Outreach (Application Safety Limit)</label>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={maxTotalDaily}
                  onChange={(e) => setMaxTotalDaily(parseInt(e.target.value, 10) || 100)}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-teal-500"
                />
                <span className="text-[11px] text-slate-400 block">
                  Overall safety cap across all senders today. Conservative default: 100.
                </span>
              </div>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs">
                <strong>Safety Warning:</strong> Never increase safety limits before verifying SPF, DKIM, and DMARC, and gradually warming up sender accounts.
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowConfigModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={configSubmitting}
                  className="px-4 py-2 text-xs font-bold text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors disabled:opacity-50"
                >
                  {configSubmitting ? 'Saving...' : 'Save Configuration'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
