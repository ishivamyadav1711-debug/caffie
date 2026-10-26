import fs from 'fs';
import path from 'path';

// --- Simple Environment Loader for Local Testing ---
function loadLocalEnv() {
  const envFiles = ['.env.local', '.env'];
  for (const file of envFiles) {
    const fullPath = path.resolve(process.cwd(), file);
    if (fs.existsSync(fullPath)) {
      const lines = fs.readFileSync(fullPath, 'utf-8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx !== -1) {
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            if (!process.env[key] && val) {
              process.env[key] = val;
            }
          }
        }
      }
    }
  }
}

loadLocalEnv();

interface Lead {
  platform: string;
  title: string;
  selftext: string;
  url: string;
  created_utc?: number;
  author?: string;
  subreddit?: string;
  scrapedAt?: string;
  score?: number;
  reason?: string;
  intent_category?: string;
}

interface AIAnalysisResult {
  score: number;
  reason: string;
  intent_category: string;
}

async function analyzeWithOpenRouter(
  apiKey: string,
  title: string,
  selftext: string
): Promise<AIAnalysisResult> {
  const model = process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free';
  const prompt = `Analyze this social media post. Does this person or company have a high intent to buy software, services, or products? Give a score from 0 to 100 (100 being ready to buy now) and a 1-sentence reason. Return JSON: { "score": number, "reason": "string", "intent_category": "string" }.

Title: ${title}
Post Content: ${selftext.slice(0, 1000)}`;

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://leadpilot.io',
      'X-Title': 'LeadPilot',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: 'You are an expert sales analyst identifying high-intent purchasing leads. Always output valid JSON.',
        },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    throw new Error(`OpenRouter API error ${res.status}: ${errorBody}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '{}';
  const parsed = JSON.parse(content);
  return {
    score: Number(parsed.score) || 0,
    reason: String(parsed.reason || 'No reason provided.'),
    intent_category: String(parsed.intent_category || 'general'),
  };
}

async function analyzeWithGroq(
  apiKey: string,
  title: string,
  selftext: string
): Promise<AIAnalysisResult> {
  const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  const prompt = `Analyze this social media post. Does this person or company have a high intent to buy software, services, or products? Give a score from 0 to 100 (100 being ready to buy now) and a 1-sentence reason. Return JSON: { "score": number, "reason": "string", "intent_category": "string" }.

Title: ${title}
Post Content: ${selftext.slice(0, 1000)}`;

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: 'You are an expert sales analyst identifying high-intent purchasing leads. Always output valid JSON.',
        },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    throw new Error(`Groq API error ${res.status}: ${errorBody}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '{}';
  const parsed = JSON.parse(content);
  return {
    score: Number(parsed.score) || 0,
    reason: String(parsed.reason || 'No reason provided.'),
    intent_category: String(parsed.intent_category || 'general'),
  };
}

async function analyzeWithOpenAI(
  apiKey: string,
  title: string,
  selftext: string
): Promise<AIAnalysisResult> {
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const prompt = `Analyze this social media post. Does this person or company have a high intent to buy software, services, or products? Give a score from 0 to 100 (100 being ready to buy now) and a 1-sentence reason. Return JSON: { score: number, reason: string, intent_category: string }.

Title: ${title}
Post Content: ${selftext.slice(0, 1000)}`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: 'You are an expert sales analyst identifying high-intent purchasing leads. Always output valid JSON.',
        },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    throw new Error(`OpenAI API error ${res.status}: ${errorBody}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '{}';
  const parsed = JSON.parse(content);
  return {
    score: Number(parsed.score) || 0,
    reason: String(parsed.reason || 'No reason provided.'),
    intent_category: String(parsed.intent_category || 'general'),
  };
}

async function analyzeWithGemini(
  apiKey: string,
  title: string,
  selftext: string
): Promise<AIAnalysisResult> {
  const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const prompt = `Analyze this social media post. Does this person or company have a high intent to buy software, services, or products? Give a score from 0 to 100 (100 being ready to buy now) and a 1-sentence reason. Return JSON: { "score": number, "reason": "string", "intent_category": "string" }.

Title: ${title}
Post Content: ${selftext.slice(0, 1000)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2,
      },
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    throw new Error(`Gemini API error ${res.status}: ${errorBody}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  const parsed = JSON.parse(text);
  return {
    score: Number(parsed.score) || 0,
    reason: String(parsed.reason || 'No reason provided.'),
    intent_category: String(parsed.intent_category || 'general'),
  };
}

function mockAIAnalysis(title: string, selftext: string): AIAnalysisResult {
  const combined = (title + ' ' + selftext).toLowerCase();

  // Evaluate buyer intent signals
  const isFreelancerSelling = combined.includes('[for hire]') || combined.includes('i can help') || combined.includes('my work:') || combined.includes('rate:');
  const isAgencyPitching = combined.includes('technologies') || combined.includes('contact now') || combined.includes('get quotation');
  const isLookingForHelp = combined.includes('need') || combined.includes('looking for') || combined.includes('recommend') || combined.includes('hiring') || combined.includes('budget');

  let baseScore = 50;
  let category = 'general';
  let reason = '';

  if (isLookingForHelp && !isFreelancerSelling && !isAgencyPitching) {
    baseScore = 80 + Math.floor(Math.random() * 16); // 80 - 95
    category = 'active_buyer';
    reason = 'The post demonstrates explicit need or request for software and professional service recommendations with buying intent.';
  } else if (isFreelancerSelling) {
    baseScore = 20 + Math.floor(Math.random() * 20); // 20 - 39
    category = 'service_seller';
    reason = 'The author is advertising their own freelance services rather than seeking to purchase a solution.';
  } else if (isAgencyPitching) {
    baseScore = 25 + Math.floor(Math.random() * 15); // 25 - 39
    category = 'vendor_promotion';
    reason = 'This post is promotional marketing and vendor content seeking clients, not an active buyer.';
  } else {
    // Generate varied test scores for pipeline flow testing
    baseScore = Math.floor(Math.random() * 60) + 35; // 35 - 94
    if (baseScore >= 70) {
      category = 'prospective_buyer';
      reason = 'Post highlights business bottlenecks and operational challenges that indicate readiness for tool adoption.';
    } else {
      category = 'low_intent';
      reason = 'Discussion lacks clear commercial urgency or purchase indicators.';
    }
  }

  return {
    score: baseScore,
    reason,
    intent_category: category,
  };
}

async function scoreLead(
  lead: Lead,
  apiKeyType: 'openrouter' | 'groq' | 'gemini' | 'openai' | 'none',
  apiKey?: string
): Promise<AIAnalysisResult> {
  const title = lead.title || '';
  const selftext = lead.selftext || '';

  if (apiKeyType === 'openrouter' && apiKey) {
    try {
      return await analyzeWithOpenRouter(apiKey, title, selftext);
    } catch (err: any) {
      console.warn(`[AI Scoring] OpenRouter API call failed (${err.message}). Falling back to mock scoring.`);
    }
  } else if (apiKeyType === 'groq' && apiKey) {
    try {
      return await analyzeWithGroq(apiKey, title, selftext);
    } catch (err: any) {
      console.warn(`[AI Scoring] Groq API call failed (${err.message}). Falling back to mock scoring.`);
    }
  } else if (apiKeyType === 'gemini' && apiKey) {
    try {
      return await analyzeWithGemini(apiKey, title, selftext);
    } catch (err: any) {
      console.warn(`[AI Scoring] Gemini API call failed (${err.message}). Falling back to mock scoring.`);
    }
  } else if (apiKeyType === 'openai' && apiKey) {
    try {
      return await analyzeWithOpenAI(apiKey, title, selftext);
    } catch (err: any) {
      console.warn(`[AI Scoring] OpenAI API call failed (${err.message}). Falling back to mock scoring.`);
    }
  }

  return mockAIAnalysis(title, selftext);
}

async function main() {
  console.log('='.repeat(65));
  console.log('  STARTING AI INTENT SCORING PIPELINE (Phase 2 - Local Only)');
  console.log('='.repeat(65));

  const inputPath = path.resolve(process.cwd(), 'data', 'local-scraped-leads.json');
  if (!fs.existsSync(inputPath)) {
    console.error(`[AI Scoring] Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const rawData = fs.readFileSync(inputPath, 'utf-8');
  const parsedData = JSON.parse(rawData);
  const leads: Lead[] = Array.isArray(parsedData) ? parsedData : (parsedData.leads || []);

  console.log(`[AI Scoring] Loaded ${leads.length} leads from ${inputPath}`);

  // Check for AI API keys in priority order: OpenRouter -> Groq -> Gemini -> OpenAI
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  const openAiKey = process.env.OPENAI_API_KEY;

  let keyType: 'openrouter' | 'groq' | 'gemini' | 'openai' | 'none' = 'none';
  let activeKey: string | undefined = undefined;

  if (openRouterKey && openRouterKey.trim().length > 0) {
    keyType = 'openrouter';
    activeKey = openRouterKey;
    console.log('[AI Scoring] Using configured OpenRouter API (Primary LLM) for intent scoring.');
  } else if (groqKey && groqKey.trim().length > 0) {
    keyType = 'groq';
    activeKey = groqKey;
    console.log('[AI Scoring] Using configured Groq API (Fast Fallback LLM) for intent scoring.');
  } else if (geminiKey && geminiKey.trim().length > 0) {
    keyType = 'gemini';
    activeKey = geminiKey;
    console.log('[AI Scoring] Using configured Gemini API (Last-Resort LLM) for intent scoring.');
  } else if (openAiKey && openAiKey.trim().length > 0) {
    keyType = 'openai';
    activeKey = openAiKey;
    console.log('[AI Scoring] Using configured OpenAI API for intent scoring.');
  } else {
    console.warn('\n' + '!'.repeat(65));
    console.warn('  WARNING: No OPENROUTER_API_KEY, GROQ_API_KEY, or GEMINI_API_KEY found.');
    console.warn('  Generating realistic mock AI scoring for local pipeline verification.');
    console.warn('!'.repeat(65) + '\n');
  }

  console.log(`[AI Scoring] Analyzing ${leads.length} leads...`);
  const scoredLeads: Lead[] = [];

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    console.log(`\nAnalyzing Lead ${i + 1}/${leads.length}: "${lead.title.slice(0, 60)}..."`);
    const analysis = await scoreLead(lead, keyType, activeKey);

    const scoredLead: Lead = {
      ...lead,
      score: analysis.score,
      reason: analysis.reason,
      intent_category: analysis.intent_category,
    };

    scoredLeads.push(scoredLead);
    console.log(`  -> Score: ${scoredLead.score}/100 | Category: ${scoredLead.intent_category}`);
    console.log(`  -> Reason: ${scoredLead.reason}`);
  }

  // Filter high-intent leads (score >= 70)
  const highIntentLeads = scoredLeads.filter((l) => (l.score ?? 0) >= 70);

  // Summary printout requested by user
  console.log('\n' + '='.repeat(65));
  console.log(`Analyzed ${scoredLeads.length} leads. Found ${highIntentLeads.length} high-intent leads.`);
  console.log('='.repeat(65));

  // Save to data/high-intent-leads.json
  const outputPath = path.resolve(process.cwd(), 'data', 'high-intent-leads.json');
  const outputPayload = {
    analyzedAt: new Date().toISOString(),
    totalAnalyzed: scoredLeads.length,
    highIntentCount: highIntentLeads.length,
    threshold: 70,
    leads: highIntentLeads,
  };

  fs.writeFileSync(outputPath, JSON.stringify(outputPayload, null, 2), 'utf-8');
  console.log(`[AI Scoring] Saved high-intent leads to: ${outputPath}`);
}

main().catch((err) => {
  console.error('Fatal error during lead scoring:', err);
  process.exit(1);
});
