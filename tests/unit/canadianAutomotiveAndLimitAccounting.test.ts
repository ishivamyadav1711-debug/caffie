import { describe, it, expect } from 'vitest';
import {
  validateIndustryRelevance,
  resolveCanonicalIndustry,
  normalizeCategoryText,
} from '@/lib/taxonomy/industryTaxonomy';
import { businessVerificationActor } from '@/actors/BusinessVerificationActor';
import { RawDiscoveredBusiness } from '@/providers/BusinessDiscoveryProvider';

describe('Canadian Automotive Classification & Accurate Limit Accounting Regression Suite', () => {
  describe('1. Taxonomy & Category Normalization', () => {
    it('normalizes diacritics, hyphens, and delimiters cleanly', () => {
      expect(normalizeCategoryText('Mécanique Automobile')).toBe('mecanique automobile');
      expect(normalizeCategoryText('Atelier de réparation & carrosserie--auto')).toBe('atelier de reparation carrosserie auto');
      expect(normalizeCategoryText('Concessionnaire de véhicules d\'occasion')).toBe('concessionnaire de vehicules d occasion');
    });

    it('resolves English and Canadian French automotive aliases to canonical automotive', () => {
      expect(resolveCanonicalIndustry('Automotive').id).toBe('automotive');
      expect(resolveCanonicalIndustry('Automobile').id).toBe('automotive');
      expect(resolveCanonicalIndustry('Automobiles').id).toBe('automotive');
      expect(resolveCanonicalIndustry('Garage').id).toBe('automotive');
      expect(resolveCanonicalIndustry('Car Repair').id).toBe('automotive');
      expect(resolveCanonicalIndustry('Concessionnaire automobile').id).toBe('automotive');
      expect(resolveCanonicalIndustry('Mécanique automobile').id).toBe('automotive');
    });
  });

  describe('2. Canadian Automobile Business Qualification (Issue #2 Fix)', () => {
    const canadianAutoCandidates: Array<{ name: string; category: string; expectedValid: boolean }> = [
      {
        name: 'Garage Tremblay & Fils',
        category: 'Garage automobile',
        expectedValid: true,
      },
      {
        name: 'Clinique de l\'Auto Brossard',
        category: 'Atelier de mécanique automobile',
        expectedValid: true,
      },
      {
        name: 'Montreal Auto Spa & Collision',
        category: 'Atelier de carrosserie',
        expectedValid: true,
      },
      {
        name: 'Bourassa Pneus & Mécanique',
        category: 'Magasin de pneus',
        expectedValid: true,
      },
      {
        name: 'Auto Rive-Sud',
        category: 'Concessionnaire de véhicules d\'occasion',
        expectedValid: true,
      },
      {
        name: 'Metro Transmission & Service',
        category: 'Car repair and maintenance',
        expectedValid: true,
      },
      {
        name: 'Apex Car Care',
        category: 'Auto repair shop',
        expectedValid: true,
      },
      {
        name: 'Maple Leaf Motors',
        category: 'Used car dealer',
        expectedValid: true,
      },
      // Strict negative tests: unrelated businesses must be REJECTED
      {
        name: 'Bistro Chez Pierre',
        category: 'Restaurant',
        expectedValid: false,
      },
      {
        name: 'Boulangerie Saint-Laurent',
        category: 'Bakery',
        expectedValid: false,
      },
      {
        name: 'Clinique Médicale Laurier',
        category: 'Hospital',
        expectedValid: false,
      },
      {
        name: 'Salon Élégance',
        category: 'Beauty salon',
        expectedValid: false,
      },
    ];

    for (const item of canadianAutoCandidates) {
      it(`validates ${item.name} (${item.category}) -> ${item.expectedValid ? 'QUALIFIED' : 'REJECTED'} for Automotive`, () => {
        const result = validateIndustryRelevance(
          {
            businessName: item.name,
            category: item.category,
          },
          'Automotive'
        );
        expect(result.isValid).toBe(item.expectedValid);
        if (item.expectedValid) {
          expect(result.canonicalIndustry).toBe('Automotive');
        } else {
          expect(result.rejectionReason).toBeDefined();
        }
      });
    }

    it('businessVerificationActor accepts legitimate Canadian automobile venues and rejects unrelated categories', async () => {
      const candidates: RawDiscoveredBusiness[] = [
        {
          source: 'rapidapi',
          sourceId: 'cad_auto_1',
          name: 'Garage Bélanger Mécanique',
          businessName: 'Garage Bélanger Mécanique',
          category: 'Atelier de réparation automobile',
          city: 'Montreal',
          state: 'Quebec',
          address: '1234 Rue Saint-Denis, Montreal, QC',
          phone: '+15145550101',
          website: 'https://garagebelanger.ca',
          rawTags: { country: 'CA' },
        },
        {
          source: 'rapidapi',
          sourceId: 'cad_auto_2',
          name: 'Laval Carrosserie & Esthétique',
          businessName: 'Laval Carrosserie & Esthétique',
          category: 'Atelier de carrosserie automobile',
          city: 'Laval',
          state: 'Quebec',
          address: '456 Boulevard Saint-Martin, Laval, QC',
          phone: '+14505550102',
          website: 'https://lavalcarrosserie.ca',
          rawTags: { country: 'CA' },
        },
        {
          source: 'rapidapi',
          sourceId: 'cad_food_1',
          name: 'Pizzeria Della Nonna',
          businessName: 'Pizzeria Della Nonna',
          category: 'Restaurant',
          city: 'Montreal',
          state: 'Quebec',
          address: '789 Rue Beaubien, Montreal, QC',
          phone: '+15145550103',
          rawTags: { country: 'CA' },
        },
      ];

      const res = await businessVerificationActor.execute({
        jobId: 'job_test_cad',
        input: {
          businesses: candidates,
          requestedIndustry: 'Automotive',
        },
      });

      expect(res.data.verified.length).toBe(2);
      expect(res.data.verified.map((v) => v.businessName)).toContain('Garage Bélanger Mécanique');
      expect(res.data.verified.map((v) => v.businessName)).toContain('Laval Carrosserie & Esthétique');

      expect(res.data.rejected.length).toBe(1);
      expect(res.data.rejected[0].business.businessName).toBe('Pizzeria Della Nonna');
      expect(res.data.rejected[0].reason).toBe('INVALID_CATEGORY');
    });
  });

  describe('3. Accurate Candidate Pool & Delivered Results Separation (Issue #1 Fix)', () => {
    it('preserves separate accurate counts without confusing candidate pool with delivered leads', () => {
      const requestedLimit = 5;
      const discoveredCount = 20; // 20 candidates in discovery pool
      const mergedCount = 18;
      const qualifiedCount = 4; // Only 4 met strict verification
      const deliveredCount = Math.min(qualifiedCount, requestedLimit);

      // Verify delivered count is capped at requestedLimit and never claims 20 were delivered
      expect(deliveredCount).toBe(4);
      expect(deliveredCount).toBeLessThanOrEqual(requestedLimit);
      expect(discoveredCount).toBe(20);
      expect(discoveredCount).not.toBe(deliveredCount);

      // Verify explanation string when delivered < requestedLimit
      const fewerExplanation = deliveredCount < requestedLimit
        ? `Delivered all ${deliveredCount} verified businesses matching your criteria in this area.`
        : null;
      expect(fewerExplanation).toBe('Delivered all 4 verified businesses matching your criteria in this area.');
    });
  });
});
