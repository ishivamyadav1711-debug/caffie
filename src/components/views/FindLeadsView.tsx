'use client';

import React, { useState } from 'react';
import { 
  Search, 
  MapPin, 
  Filter, 
  Target, 
  Zap, 
  Database, 
  Layers, 
  CheckCircle2, 
  ArrowRight, 
  Sparkles, 
  Building, 
  RotateCcw,
  AlertCircle
} from 'lucide-react';
import { Lead } from '@/types';
import { parseApiResponse, LeadPilotApiError } from '@/lib/apiClient';

interface FindLeadsViewProps {
  onSelectLead: (lead: Lead) => void;
  onOpenQuickAudit: (lead?: Lead) => void;
  onShowToast: (title: string, desc?: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
  onNavigate?: (tab: 'leads' | 'overview') => void;
}

export const FindLeadsView: React.FC<FindLeadsViewProps> = ({
  onSelectLead,
  onOpenQuickAudit,
  onShowToast,
  onNavigate,
}) => {
  const [industry, setIndustry] = useState('Restaurants');
  const [stateName, setStateName] = useState('Uttar Pradesh');
  const [city, setCity] = useState('Greater Noida');
  const [isScanning, setIsScanning] = useState(false);
  const [discoveredBatches, setDiscoveredBatches] = useState<any[]>([]);
  const [scanOffset, setScanOffset] = useState<number>(0);
  const lastScanKeyRef = React.useRef<string>('');

  const runNewScan = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsScanning(true);

    const currentKey = `${stateName}:${city.trim()}:${industry}`;
    const isSameCriteria = lastScanKeyRef.current === currentKey;
    const nextOffset = isSameCriteria ? scanOffset + 50 : 0;
    setScanOffset(nextOffset);
    lastScanKeyRef.current = currentKey;

    try {
      const res = await fetch('/api/leads/search?sync=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          country: 'India',
          state: stateName,
          city: city.trim(),
          industry,
          contactFilter: 'All Contacts',
          websiteFilter: 'Any Website',
          limit: 50,
          offset: nextOffset,
          page: Math.floor(nextOffset / 50) + 1,
          sync: true,
        }),
      });

      const data = await parseApiResponse(res, '/api/leads/search?sync=true');
      setIsScanning(false);

      if (data.success && Array.isArray(data.leads)) {
        if (data.leads.length === 0 && nextOffset > 0) {
          onShowToast(
            'Discovery Complete',
            data.statusReason || 'No more businesses found in this area. Try a different location or category.',
            'info'
          );
          return;
        }

        const newBatch = {
          id: `batch-${Date.now()}`,
          title: `${city ? `${city}, ` : ''}${stateName} ${industry} (Offset: ${nextOffset})`,
          location: `${city ? `${city}, ` : ''}${stateName}`,
          leadsFound: data.leads.length,
          noWebsite: data.summary?.noWebsite || 0,
          needsImprovement: data.summary?.needsImprovement || 0,
          date: 'Just now',
          status: 'Completed',
          leads: data.leads,
        };

        setDiscoveredBatches((prev) => [newBatch, ...prev]);
        onShowToast(
          'Pipeline Complete',
          `Discovered and audited ${data.leads.length} real businesses in ${city ? `${city}, ` : ''}${stateName}.`,
          'success'
        );
      } else {
        const noMoreMsg =
          data.statusReason ||
          data.error ||
          (nextOffset > 0
            ? 'No more businesses found in this area. Try a different location or category.'
            : 'Pipeline run returned no candidates.');
        onShowToast('Discovery Notice', noMoreMsg, 'warning');
      }
    } catch (err: any) {
      setIsScanning(false);
      const errorMsg = err instanceof LeadPilotApiError ? err.message : (err.message || 'Pipeline network failure.');
      onShowToast('Scan Notice', errorMsg, 'warning');
    }
  };


  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header Description */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-lg border border-[#E5E7EB] shadow-subtle">
        <div>
          <h1 className="text-[16px] font-bold text-[#171717]">Automated Lead Discovery Engine</h1>
          <p className="text-[12px] text-[#6B7280]">
            Scan local regions for businesses with missing websites or websites needing improvement, and extract verified owner contact info.
          </p>
        </div>
      </div>

      {/* Discovery Configuration Form */}
      <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-subtle p-5">
        <h2 className="text-[13.5px] font-semibold text-[#171717] mb-3 flex items-center gap-2">
          <Target className="h-4 w-4 text-teal-700" />
          <span>Configure Discovery Parameters</span>
        </h2>

        <form onSubmit={runNewScan} className="space-y-4 text-[12.5px]">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-[11.5px] font-semibold text-[#374151] mb-1">
                Industry or Niche
              </label>
              <select
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                className="w-full rounded-md border border-[#D1D5DB] bg-[#F7F8FA] px-3 py-1.5 text-[12.5px] text-[#171717] focus:border-teal-700 focus:bg-white focus:outline-none"
              >
                <option value="Restaurants">Restaurants & Dining</option>
                <option value="Clinics">Dental & Medical Clinics</option>
                <option value="Hospitals">Hospitals</option>
                <option value="Cafes">Cafes & Bakeries</option>
                <option value="Hotels">Hotels & Hospitality</option>
                <option value="Gyms">Fitness & Gyms</option>
                <option value="Salons">Salons & Spas</option>
                <option value="Real Estate">Real Estate Agencies</option>
                <option value="Education">Schools & Institutes</option>
                <option value="Retail">Retail & Supermarkets</option>
              </select>
            </div>

            <div>
              <label className="block text-[11.5px] font-semibold text-[#374151] mb-1">
                Indian State / UT
              </label>
              <input
                type="text"
                value={stateName}
                onChange={(e) => setStateName(e.target.value)}
                placeholder="e.g. Uttar Pradesh, Delhi, Maharashtra"
                className="w-full rounded-md border border-[#D1D5DB] bg-[#F7F8FA] px-3 py-1.5 text-[12.5px] text-[#171717] focus:border-teal-700 focus:bg-white focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11.5px] font-semibold text-[#374151] mb-1">
                City / District
              </label>
              <div className="relative">
                <MapPin className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#9CA3AF]" />
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="e.g. Greater Noida, Noida, Mumbai"
                  className="w-full rounded-md border border-[#D1D5DB] bg-[#F7F8FA] pl-8 pr-3 py-1.5 text-[12.5px] text-[#171717] focus:border-teal-700 focus:bg-white focus:outline-none"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#F1F3F5]">
            <div className="flex items-center gap-4 text-[12px] text-[#4B5563]">
              <span className="text-[11.5px] text-teal-800 font-medium">
                Pipeline: Real Discovery → Extraction → Crawl → Technical Audit → Contact Verification
              </span>
            </div>

            <button
              type="submit"
              disabled={isScanning}
              className="flex items-center gap-1.5 rounded-md bg-teal-700 hover:bg-teal-800 text-white px-4 py-2 text-[12.5px] font-medium transition-all shadow-subtle disabled:opacity-50 cursor-pointer"
            >
              {isScanning ? (
                <>
                  <Zap className="h-3.5 w-3.5 animate-spin" />
                  <span>Executing Pipeline on Real Data...</span>
                </>
              ) : (
                <>
                  <Search className="h-3.5 w-3.5" />
                  <span>Launch Lead Discovery Run</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Discovered Batches History */}
      <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-subtle overflow-hidden">
        <div className="p-3.5 border-b border-[#E5E7EB] flex items-center justify-between">
          <h3 className="text-[13.5px] font-semibold text-[#171717]">Discovery Batch History</h3>
          <span className="text-[11.5px] text-[#6B7280]">Real-time pipeline sync</span>
        </div>

        {discoveredBatches.length === 0 ? (
          <div className="p-10 text-center text-slate-500 text-[12.5px]">
            No discovery runs launched in this session. Configure criteria above and launch a real run.
          </div>
        ) : (
          <div className="divide-y divide-[#F1F3F5]">
            {discoveredBatches.map((batch) => (
              <div
                key={batch.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[#F9FAFB] transition-colors"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[#171717] text-[13px]">{batch.title}</span>
                    <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 text-[10.5px] font-medium text-emerald-800 border border-emerald-200">
                      <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                      {batch.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-[11.5px] text-[#6B7280]">
                    <span>{batch.location}</span>
                    <span>•</span>
                    <span>{batch.date}</span>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-[12px]">
                  <div className="text-right">
                    <span className="font-bold text-[#171717] tabular-nums">{batch.leadsFound} Leads</span>
                    <div className="text-[11px] text-[#6B7280]">
                      <span className="text-rose-700 font-medium">{batch.noWebsite} No Site</span> •{' '}
                      <span className="text-amber-700 font-medium">{batch.needsImprovement} Needs Improvement</span>
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      onShowToast('Viewing Leads', `Discovered ${batch.leadsFound} leads.`, 'info');
                      if (onNavigate) onNavigate('leads');
                    }}
                    className="flex items-center gap-1 rounded border border-[#D1D5DB] bg-white px-3 py-1.5 text-[11.5px] font-medium text-[#374151] hover:bg-[#F3F4F6] shadow-subtle cursor-pointer"
                  >
                    <span>View in Leads</span>
                    <ArrowRight className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
