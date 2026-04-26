import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_BUILDING_CODE_MODEL || 'gpt-5.5';

const TOOL_COST = 1;
const DAILY_RUN_LIMIT = 100;

function json(res, status, body) {
  return res.status(status).json(body);
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function safeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, credits, plan')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function getTodayUsageCount(userId) {
  const { count, error } = await supabase
    .from('tool_usage_logs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('usage_date', getTodayKey());

  if (error) throw error;
  return count || 0;
}

async function logUsage({ userId, mode, creditsUsed }) {
  const { error } = await supabase
    .from('tool_usage_logs')
    .insert({
      user_id: userId,
      mode,
      credits_used: creditsUsed,
      usage_date: getTodayKey()
    });

  if (error) throw error;
}

async function deductCredits(userId, creditsToDeduct) {
  const profile = await getProfile(userId);
  if (!profile) throw new Error('Profile not found');

  const currentCredits = Number(profile.credits || 0);

  if (currentCredits < creditsToDeduct) {
    throw new Error(`Not enough credits. You need ${creditsToDeduct} credit.`);
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      credits: currentCredits - creditsToDeduct,
      updated_at: new Date().toISOString()
    })
    .eq('id', userId);

  if (error) throw error;
}

async function enforceUsageLimits(userId) {
  if (!userId) throw new Error('Missing user_id');

  const profile = await getProfile(userId);
  if (!profile) throw new Error('Profile not found');

  const currentCredits = Number(profile.credits || 0);

  if (currentCredits < TOOL_COST) {
    throw new Error(`Not enough credits. You need ${TOOL_COST} credit.`);
  }

  const todayUsageCount = await getTodayUsageCount(userId);

  if (todayUsageCount >= DAILY_RUN_LIMIT) {
    throw new Error(`Daily usage limit reached. Max ${DAILY_RUN_LIMIT} runs per day.`);
  }

  return profile;
}

function buildBuildingCodePrompt({
  location,
  trade,
  projectType,
  question
}) {
  return `
ROLE:
You are a Code & Compliance Clause Finder for trade and construction businesses.

TASK:
Answer the user's question by doing deep research based on the location, trade, and project type they provide.

Use the user's location / region / country plus whether the job is Residential or Commercial to determine which building codes, regulations, council rules, standards, permits, compliance guides, or official authorities are relevant.

You do NOT have uploaded documents. You must independently research current official sources.

USER LOCATION:
${location}

USER TRADE:
${trade}

PROJECT TYPE:
${projectType}

QUESTION:
${question}

SEARCH RULES:
- Think hard before answering.
- Research deeply across current official sources.
- Adapt your research to the user's location automatically.
- Use project type heavily:
  - Residential may use housing, dwelling, domestic, homeowner, or residential rules.
  - Commercial may use commercial occupancy, accessibility, fire, workplace, public use, or business premises rules.
- Prioritise official government, regulator, council, code authority, standards body, and permitting sources for that location.
- Use the most recent version of any law, code, regulation, standard, or guidance.
- If multiple jurisdictions may apply, prioritise the most specific relevant authority first:
  1. City / council / local authority
  2. State / province / region
  3. National building code / act / regulation
- Do not rely on blogs, forums, social posts, supplier pages, or random websites unless no official source exists.
- If exact clauses are unavailable publicly, state that clearly.
- Do not guess clause numbers, page numbers, or links.
- If a paid or restricted standard likely applies, identify the standard and state that exact clauses may require paid access.

OUTPUT FORMAT:

Answer:
<one sentence direct answer>

Code/Standard:
<name of relevant code, act, regulation, council rule, standard, permit guide, or official document>

Clause/Section:
<clause, section, schedule, page, article, table, figure, or closest official identifier>

Source:
<official source name>

Link:
<direct official URL>

Confidence:
<Low / Medium / High>

Plain English Meaning:
<brief practical explanation for someone on site>

Verification Note:
<brief note telling the user what should be verified with the council, inspector, licensed professional, or official standard if needed>

IMPORTANT:
- Be precise.
- Do not guess.
- Prefer official sources.
- If uncertain, say exactly what could not be verified.
- Keep the answer concise but highly useful.
`.trim();
}

async function openAIResponsesWithSearch(prompt) {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is missing in Vercel environment variables');
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      reasoning: {
        effort: 'high'
      },
      tools: [
        {
          type: 'web_search_preview'
        }
      ],
      input: [
        {
          role: 'user',
          content: prompt
        }
      ]
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || JSON.stringify(data));
  }

  return data.output_text || '';
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};

    const userId = safeText(body.user_id);
    const location = safeText(body.location);
    const trade = safeText(body.trade);
    const projectType = safeText(body.projectType);
    const question = safeText(body.question);

    if (!location || !trade || !projectType || !question) {
      return json(res, 400, { error: 'Missing required fields' });
    }

    await enforceUsageLimits(userId);

    const prompt = buildBuildingCodePrompt({
      location,
      trade,
      projectType,
      question
    });

    const result = await openAIResponsesWithSearch(prompt);

    await deductCredits(userId, TOOL_COST);

    await logUsage({
      userId,
      mode: 'building_code_search',
      creditsUsed: TOOL_COST
    });

    return json(res, 200, {
      success: true,
      result: result || 'No building code result returned.'
    });

  } catch (error) {
    return json(res, 500, {
      error: error.message || 'Something went wrong searching building codes'
    });
  }
}
