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

  if (!profile) {
    throw new Error('Profile not found');
  }

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
  if (!userId) {
    throw new Error('Missing user_id');
  }

  const profile = await getProfile(userId);

  if (!profile) {
    throw new Error('Profile not found');
  }

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
You are a building code and compliance research assistant for trade businesses.

Your job is to search for the most relevant building code, regulation, standard, council guidance, or official source based on the user's location and question.

USER DETAILS
Location / Area: ${location}
Trade: ${trade}
Project Type: ${projectType}
Question / Scenario:
${question}

RESEARCH RULES
- Search current and official sources first.
- Prioritise government, council, regulator, standards body, and official building code sources.
- If the question is New Zealand based, prioritise:
  - building.govt.nz
  - legislation.govt.nz
  - local council websites
  - WorkSafe where relevant
  - MBIE guidance
- If the exact answer is not clear, say that clearly.
- Do not guess clause numbers.
- Do not invent source links.
- Do not claim a clause exists unless you found it.
- If a paid or restricted standard is likely required, say that and identify the likely standard.

OUTPUT FORMAT

## Direct Answer
Give a clear answer in plain English.

## Code / Regulation Found
Name the building code, act, regulation, council rule, or standard.

## Clause / Section
Give the clause, section, schedule, page, or closest official reference if found.

## Source Link
Provide the official source link.

## What This Means On Site
Explain what the user should do in practical trade language.

## Confidence
High / Medium / Low

## Important Note
Include a short reminder that the user should confirm final compliance with the relevant council, inspector, licensed professional, or official standard where required.
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
        effort: 'medium'
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
