'use client';

import React, { useState } from 'react';
import { 
  Building, 
  MapPin, 
  Mail, 
  Globe, 
  Layers, 
  ArrowRight, 
  Loader2, 
  Check, 
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  Star,
  SlidersHorizontal,
  Compass
} from 'lucide-react';
import { ContactFilter, WebsiteFilter, NumberOfLeads, ReviewSortOption } from '@/types';
import { 
  SUPPORTED_COUNTRIES, 
  getRegionsForCountry, 
  getCitiesForRegion 
} from '@/data/geographyData';

export interface LeadFilterCriteria {
  country: 'India' | 'USA' | 'Canada';
  state: string;
  city: string;
  industry: string;
  contact: ContactFilter;
  website: WebsiteFilter;
  limit: NumberOfLeads;
  minRating?: number;
  minReviews?: number;
  excludePerfectRating?: boolean;
  requirePositiveReviewEvidence?: boolean;
  reviewSort?: ReviewSortOption;
}

interface LeadSearchCardProps {
  initialCriteria?: Partial<LeadFilterCriteria>;
  isSearchingExternal?: boolean;
  liveProgressLog?: { actorId: string; stepName: string; message: string; count?: number; timestamp: string }[];
  onSearchStart?: () => void;
  onSearchSubmit?: (criteria: LeadFilterCriteria) => void;
  onViewLeads?: () => void;
}

export const LeadSearchCard: React.FC<LeadSearchCardProps> = ({
  initialCriteria,
  isSearchingExternal = false,
  liveProgressLog = [],
  onSearchStart,
  onSearchSubmit,
  onViewLeads,
}) => {
  // 1. COUNTRY: USA, Canada, India
  const [selectedCountry, setSelectedCountry] = useState<'India' | 'USA' | 'Canada'>(
    (initialCriteria?.country as any) || 'USA'
  );

  // 2. REGION: State / Province / Territory
  const [selectedState, setSelectedState] = useState(
    initialCriteria?.state || (selectedCountry === 'USA' ? 'California' : selectedCountry === 'Canada' ? 'Ontario' : 'Maharashtra')
  );

  // 3. CITY: Curated or Custom
  const [selectedCity, setSelectedCity] = useState(
    initialCriteria?.city || (selectedCountry === 'USA' ? 'Los Angeles' : selectedCountry === 'Canada' ? 'Toronto' : 'Mumbai')
  );
  const [isCustomCity, setIsCustomCity] = useState(false);
  const [customCityText, setCustomCityText] = useState('');

  // 4. INDUSTRY: Predefined or Custom
  const [selectedIndustry, setSelectedIndustry] = useState(initialCriteria?.industry || 'Restaurants');
  const [isCustomIndustry, setIsCustomIndustry] = useState(false);
  const [customIndustryText, setCustomIndustryText] = useState('');

  // 5. CONTACT & WEBSITE: Dropdowns
  const [contact, setContact] = useState<ContactFilter>(initialCriteria?.contact || 'All Contacts');
  const [website, setWebsite] = useState<WebsiteFilter>(initialCriteria?.website || 'All Websites');

  // 6. RESULTS LIMIT: Dropdown
  const [limit, setLimit] = useState<NumberOfLeads>(initialCriteria?.limit || 100);

  // 7. REVIEW INTELLIGENCE FILTERS (Sections 9, 10, 11)
  const [showReviewFilters, setShowReviewFilters] = useState(false);
  const [minRating, setMinRating] = useState<number | undefined>(initialCriteria?.minRating);
  const [minReviews, setMinReviews] = useState<number | undefined>(initialCriteria?.minReviews);
  const [excludePerfectRating, setExcludePerfectRating] = useState<boolean>(
    initialCriteria?.excludePerfectRating ?? false
  );
  const [requirePositiveReviewEvidence, setRequirePositiveReviewEvidence] = useState<boolean>(
    initialCriteria?.requirePositiveReviewEvidence ?? false
  );
  const [reviewSort, setReviewSort] = useState<ReviewSortOption>(
    initialCriteria?.reviewSort || 'default'
  );

  // Background automated multi-step crawler progress
  const [jobState, setJobState] = useState<'idle' | 'running' | 'completed'>('idle');
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  // Available regions & cities for the selected Country
  const currentCountryConfig = SUPPORTED_COUNTRIES.find((c) => c.id === selectedCountry) || SUPPORTED_COUNTRIES[1];
  const availableRegions = getRegionsForCountry(selectedCountry);
  const availableCities = getCitiesForRegion(selectedCountry, selectedState);

  // Handle Country change
  const handleCountryChange = (newCountry: 'India' | 'USA' | 'Canada') => {
    setSelectedCountry(newCountry);
    const regions = getRegionsForCountry(newCountry);
    const defaultState =
      newCountry === 'USA' ? 'California' : newCountry === 'Canada' ? 'Ontario' : 'Maharashtra';
    const stateObj = regions.find((r) => r.name === defaultState) || regions[0];
    const targetState = stateObj ? stateObj.name : '';
    setSelectedState(targetState);
    setIsCustomCity(false);
    setCustomCityText('');
    const cities = getCitiesForRegion(newCountry, targetState);
    setSelectedCity(cities[0] || `All cities in this ${newCountry === 'Canada' ? 'province' : 'state'}`);
  };

  // Handle State change
  const handleStateChange = (newState: string) => {
    setSelectedState(newState);
    setIsCustomCity(false);
    setCustomCityText('');
    const cities = getCitiesForRegion(selectedCountry, newState);
    if (cities.length > 0) {
      setSelectedCity(cities[0]);
    } else {
      setSelectedCity(`All cities in this ${selectedCountry === 'Canada' ? 'province' : 'state'}`);
    }
  };

  const activeIndustry = isCustomIndustry && customIndustryText.trim()
    ? customIndustryText.trim()
    : selectedIndustry;

  const activeCity = isCustomCity && customCityText.trim()
    ? customCityText.trim()
    : selectedCity;

  const steps = [
    { 
      label: `Finding businesses in ${activeCity ? `${activeCity}, ` : ''}${selectedState}, ${selectedCountry}...`, 
      desc: 'Querying Google Places API (Text Search New)' 
    },
    { 
      label: 'Capturing ratings & review evidence...', 
      desc: 'Extracting verified ratings, user review counts & reviews' 
    },
    { 
      label: 'Checking available websites...', 
      desc: 'Testing DNS, SSL certificates & HTTP reachability' 
    },
    { 
      label: 'Analyzing website status & mobile UX...', 
      desc: 'Auditing viewport tags, forms, CTA & conversion links' 
    },
    { 
      label: 'Preparing your leads...', 
      desc: `Returning verified results up to ${limit}` 
    },
  ];

  const popularIndustries = [
    'Restaurants',
    'Hotels',
    'Cafes',
    'Dentists',
    'Gyms',
    'Salons',
    'Hospitals',
    'Clinics',
    'Real Estate',
    'Education',
    'Retail',
    'Automotive',
    'Law Firms',
    'Plumbers',
    'Electricians',
    'Other',
  ];

  const contactOptions: { value: ContactFilter; label: string }[] = [
    { value: 'All Contacts', label: 'All Contacts' },
    { value: 'Has Phone or Email', label: 'Phone or Email (At least one)' },
    { value: 'Email + Phone', label: 'Email + Phone (Both)' },
    { value: 'Email Only', label: 'Email Only' },
    { value: 'Phone Only', label: 'Phone Only' },
    { value: 'No Contact', label: 'No Contact' },
  ];

  const websiteOptions: { value: WebsiteFilter; label: string }[] = [
    { value: 'Any Website', label: 'Any Website' },
    { value: 'Website Available', label: 'Website Available' },
    { value: 'Needs Improvement', label: 'Needs Improvement' },
    { value: 'Working', label: 'Working' },
    { value: 'No Website', label: 'No Website' },
    { value: 'Unreachable', label: 'Unreachable' },
  ];

  const limitOptions: NumberOfLeads[] = [25, 50, 100, 250, 500];

  const isSearching = jobState === 'running' || isSearchingExternal;

  const handleStartSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSearching) return;

    setJobState('running');
    setCurrentStepIndex(0);
    if (onSearchStart) {
      onSearchStart();
    }

    const isAllCities =
      activeCity.toLowerCase().startsWith('all cities') ||
      activeCity.toLowerCase().includes('all cities in');

    const criteria: LeadFilterCriteria = {
      country: selectedCountry,
      state: selectedState,
      city: isAllCities ? '' : activeCity,
      industry: activeIndustry,
      contact,
      website,
      limit,
      minRating,
      minReviews,
      excludePerfectRating,
      requirePositiveReviewEvidence,
      reviewSort,
    };

    setTimeout(() => setCurrentStepIndex(1), 500);
    setTimeout(() => setCurrentStepIndex(2), 1100);
    setTimeout(() => setCurrentStepIndex(3), 1800);
    setTimeout(() => setCurrentStepIndex(4), 2500);
    setTimeout(() => {
      setJobState('completed');
      if (onSearchSubmit) {
        onSearchSubmit(criteria);
      }
      if (onViewLeads) {
        onViewLeads();
      }
    }, 2900);
  };

  return (
    <div className="rounded-2xl border border-[#E2E8F0] bg-white p-5 sm:p-6 shadow-xs select-none">
      {/* Top Header */}
      <div className="mb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#F1F5F9] pb-4">
        <div>
          <h2 className="text-[17px] font-bold text-[#0F172A] tracking-tight flex items-center gap-2">
            <span>Find Leads</span>
            <span className="text-[11px] font-semibold text-teal-800 bg-teal-50 border border-teal-200/80 px-2 py-0.5 rounded-md">
              USA • Canada • India
            </span>
          </h2>
          <p className="text-[12.5px] text-[#64748B] mt-0.5">
            Discover real, verified businesses with live Google Places intelligence, real ratings, and review evidence.
          </p>
        </div>

        <div className="flex items-center gap-1.5 self-start sm:self-auto text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200/80 px-2.5 py-1 rounded-lg">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
          <span>Google Places Primary • Real Data Only</span>
        </div>
      </div>

      {/* Main Search Configuration Form */}
      <form onSubmit={handleStartSearch} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
          {/* 1. COUNTRY SELECTOR */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-bold text-[#475569] uppercase tracking-wider">
              Country
            </label>
            <div className="relative">
              <Globe className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#94A3B8] pointer-events-none" />
              <select
                value={selectedCountry}
                onChange={(e) => handleCountryChange(e.target.value as 'India' | 'USA' | 'Canada')}
                disabled={isSearching}
                className="w-full h-11 min-h-[44px] rounded-xl border border-[#CBD5E1] bg-white pl-10 pr-8 text-[12.5px] font-medium text-[#0F172A] focus:border-[#0F172A] focus:ring-1 focus:ring-[#0F172A] focus:outline-none transition-all cursor-pointer appearance-none shadow-2xs hover:border-[#94A3B8] disabled:bg-[#F8FAFC]"
              >
                <option value="USA">🇺🇸 United States</option>
                <option value="Canada">🇨🇦 Canada</option>
                <option value="India">🇮🇳 India</option>
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#94A3B8] pointer-events-none" />
            </div>
          </div>

          {/* 2. REGION (STATE / PROVINCE) & CITY */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-bold text-[#475569] uppercase tracking-wider">
              {currentCountryConfig.subdivisionLabel}
            </label>
            <div className="relative">
              <Compass className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#94A3B8] pointer-events-none" />
              <select
                value={selectedState}
                onChange={(e) => handleStateChange(e.target.value)}
                disabled={isSearching}
                className="w-full h-11 min-h-[44px] rounded-xl border border-[#CBD5E1] bg-white pl-10 pr-8 text-[12.5px] font-medium text-[#0F172A] focus:border-[#0F172A] focus:ring-1 focus:ring-[#0F172A] focus:outline-none transition-all cursor-pointer appearance-none shadow-2xs hover:border-[#94A3B8] disabled:bg-[#F8FAFC]"
              >
                {availableRegions.map((r) => (
                  <option key={r.name} value={r.name}>
                    {r.name} ({r.code})
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#94A3B8] pointer-events-none" />
            </div>

            {/* City Dropdown */}
            <div className="relative pt-1">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#94A3B8] pointer-events-none" />
              <select
                value={isCustomCity ? '__custom_city__' : selectedCity}
                onChange={(e) => {
                  if (e.target.value === '__custom_city__') {
                    setIsCustomCity(true);
                  } else {
                    setIsCustomCity(false);
                    setSelectedCity(e.target.value);
                  }
                }}
                disabled={isSearching}
                className="w-full h-9 rounded-lg border border-[#CBD5E1] bg-white pl-8 pr-7 text-[12px] font-medium text-[#0F172A] focus:border-[#0F172A] focus:outline-none cursor-pointer appearance-none"
              >
                <option value={`All cities in this ${selectedCountry === 'Canada' ? 'province' : 'state'}`}>
                  All cities in {selectedState}
                </option>
                {availableCities.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                <option value="__custom_city__" className="font-semibold text-teal-700">
                  + Other City / Locality...
                </option>
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-[#94A3B8] pointer-events-none" />
            </div>

            {isCustomCity && (
              <div className="pt-1">
                <input
                  type="text"
                  placeholder="Type city or locality name..."
                  value={customCityText}
                  onChange={(e) => setCustomCityText(e.target.value)}
                  disabled={isSearching}
                  className="w-full h-8 rounded-md border border-teal-500 bg-teal-50/30 px-2.5 text-[11.5px] font-medium text-[#0F172A] focus:outline-none"
                  autoFocus
                />
              </div>
            )}
          </div>

          {/* 3. INDUSTRY */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-bold text-[#475569] uppercase tracking-wider">
              Industry / Category
            </label>
            <div className="relative">
              <Building className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#94A3B8] pointer-events-none" />
              <select
                value={isCustomIndustry ? '__custom__' : selectedIndustry}
                onChange={(e) => {
                  if (e.target.value === '__custom__') {
                    setIsCustomIndustry(true);
                  } else {
                    setIsCustomIndustry(false);
                    setSelectedIndustry(e.target.value);
                  }
                }}
                disabled={isSearching}
                className="w-full h-11 min-h-[44px] rounded-xl border border-[#CBD5E1] bg-white pl-10 pr-8 text-[12.5px] font-medium text-[#0F172A] focus:border-[#0F172A] focus:ring-1 focus:ring-[#0F172A] focus:outline-none transition-all cursor-pointer appearance-none shadow-2xs hover:border-[#94A3B8] disabled:bg-[#F8FAFC]"
              >
                {popularIndustries.map((ind) => (
                  <option key={ind} value={ind}>
                    {ind}
                  </option>
                ))}
                <option value="__custom__" className="font-semibold text-teal-700">
                  + Custom Industry...
                </option>
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#94A3B8] pointer-events-none" />
            </div>

            {isCustomIndustry && (
              <div className="pt-1">
                <input
                  type="text"
                  placeholder="e.g. Dentists, Roofing, HVAC..."
                  value={customIndustryText}
                  onChange={(e) => setCustomIndustryText(e.target.value)}
                  disabled={isSearching}
                  className="w-full h-9 rounded-lg border border-teal-500 bg-teal-50/30 px-3 text-[12px] font-medium text-[#0F172A] focus:outline-none focus:ring-1 focus:ring-teal-600"
                  autoFocus
                />
              </div>
            )}
          </div>

          {/* 4. CONTACT & WEBSITE CHANNELS */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-bold text-[#475569] uppercase tracking-wider">
              Contact &amp; Website
            </label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#94A3B8] pointer-events-none" />
              <select
                value={contact}
                onChange={(e) => setContact(e.target.value as ContactFilter)}
                disabled={isSearching}
                className="w-full h-11 min-h-[44px] rounded-xl border border-[#CBD5E1] bg-white pl-10 pr-8 text-[12.5px] font-medium text-[#0F172A] focus:border-[#0F172A] focus:ring-1 focus:ring-[#0F172A] focus:outline-none transition-all cursor-pointer appearance-none shadow-2xs hover:border-[#94A3B8] disabled:bg-[#F8FAFC]"
              >
                {contactOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#94A3B8] pointer-events-none" />
            </div>

            <div className="relative pt-1">
              <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#94A3B8] pointer-events-none" />
              <select
                value={website}
                onChange={(e) => setWebsite(e.target.value as WebsiteFilter)}
                disabled={isSearching}
                className="w-full h-9 rounded-lg border border-[#CBD5E1] bg-white pl-8 pr-7 text-[12px] font-medium text-[#0F172A] focus:border-[#0F172A] focus:outline-none cursor-pointer appearance-none"
              >
                {websiteOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-[#94A3B8] pointer-events-none" />
            </div>
          </div>

          {/* 5. SEARCH LIMIT & REVIEW TOGGLE */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-bold text-[#475569] uppercase tracking-wider">
              Search Limit
            </label>
            <div className="relative">
              <Layers className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#94A3B8] pointer-events-none" />
              <select
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value) as NumberOfLeads)}
                disabled={isSearching}
                className="w-full h-11 min-h-[44px] rounded-xl border border-[#CBD5E1] bg-white pl-10 pr-8 text-[12.5px] font-medium text-[#0F172A] focus:border-[#0F172A] focus:ring-1 focus:ring-[#0F172A] focus:outline-none transition-all cursor-pointer appearance-none shadow-2xs hover:border-[#94A3B8] disabled:bg-[#F8FAFC]"
              >
                {limitOptions.map((num) => (
                  <option key={num} value={num}>
                    {num} leads
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#94A3B8] pointer-events-none" />
            </div>


          </div>
        </div>



        {/* Primary Action Button Row */}
        <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-[12px] text-[#64748B] flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-teal-500 shrink-0" />
            <span>
              Targeting: <strong className="text-[#0F172A]">{activeIndustry}</strong> in{' '}
              <strong className="text-[#0F172A]">
                {activeCity && !activeCity.startsWith('All cities') ? `${activeCity}, ` : ''}{selectedState}, {selectedCountry}
              </strong>{' '}
              • Contact: <strong className="text-[#0F172A]">{contact}</strong> • Website:{' '}
              <strong className="text-[#0F172A]">{website}</strong>
              {excludePerfectRating && <span className="text-amber-700 ml-1 font-semibold">• Excl 5.0</span>}
            </span>
          </div>

          <button
            type="submit"
            disabled={isSearching}
            className="inline-flex items-center justify-center gap-2 h-11 min-h-[44px] px-6 rounded-xl bg-[#0F172A] hover:bg-[#1E293B] text-white text-[13px] font-semibold transition-all shadow-xs disabled:opacity-75 disabled:cursor-not-allowed cursor-pointer btn-pressable self-end sm:self-auto w-full sm:w-auto"
          >
            {isSearching ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-teal-400" />
                <span>Searching Google Places...</span>
              </>
            ) : (
              <>
                <span>Find Leads</span>
                <ArrowRight className="h-4 w-4 text-teal-400" />
              </>
            )}
          </button>
        </div>
      </form>

      {/* Progress State Feedback (Real-World Actor Engine Observability) */}
      {isSearching && (
        <div className="mt-4 p-4 rounded-xl border border-teal-200/80 bg-teal-50/50 animate-fade-in space-y-2.5">
          <div className="flex items-center justify-between text-[12.5px]">
            <span className="font-semibold text-[#0F172A] flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-teal-700" />
              <span>
                {liveProgressLog.length > 0
                  ? liveProgressLog[liveProgressLog.length - 1].message
                  : steps[currentStepIndex].label}
              </span>
            </span>
            <span className="text-[11.5px] text-teal-800 font-semibold">
              {liveProgressLog.length > 0
                ? `${liveProgressLog.length} Engine Steps Completed`
                : `Step ${currentStepIndex + 1} of 5`}
            </span>
          </div>

          {liveProgressLog.length > 0 ? (
            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
              {liveProgressLog.slice(-5).map((log, idx) => (
                <div
                  key={`${log.timestamp}-${idx}`}
                  className="flex items-center justify-between text-[11.5px] p-2 rounded-lg bg-white border border-teal-200 shadow-2xs"
                >
                  <div className="flex items-center gap-2">
                    <Check className="h-3 w-3 text-teal-600 shrink-0" />
                    <span className="font-medium text-[#0F172A]">{log.message}</span>
                  </div>
                  {log.count !== undefined && (
                    <span className="px-2 py-0.5 rounded-full bg-teal-100 text-teal-800 text-[10px] font-bold">
                      {log.count} records
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11.5px]">
              {steps.map((st, idx) => {
                const isPast = idx < currentStepIndex;
                const isCurrent = idx === currentStepIndex;

                return (
                  <div
                    key={st.label}
                    className={`p-2 rounded-lg border transition-all ${
                      isPast
                        ? 'bg-white border-teal-300 text-teal-900 font-medium'
                        : isCurrent
                        ? 'bg-teal-100/70 border-teal-400 text-teal-950 font-bold ring-1 ring-teal-400/50'
                        : 'bg-white/60 border-slate-200 text-slate-400'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      {isPast ? (
                        <Check className="h-3 w-3 text-teal-700" />
                      ) : (
                        <span className="h-1.5 w-1.5 rounded-full bg-teal-600" />
                      )}
                      <span className="truncate text-[11px]">{st.label.replace('...', '')}</span>
                    </div>
                    <p className="text-[10px] text-[#64748B] mt-0.5 truncate">{st.desc}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
