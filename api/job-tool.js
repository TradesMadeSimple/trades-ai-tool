import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1';

const DAILY_RUN_LIMIT = 100;
const TOOL_COSTS = {
  generate: 4,
  clarification_answers: 0,
  revise_quote: 0,
  savePrompt: 0,
  loadPrompt: 0
};

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

function extractTextFromChatResponse(data) {
  return data?.choices?.[0]?.message?.content || '';
}

async function openAIChat(messages) {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is missing in Vercel environment variables');
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.2,
      messages
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || JSON.stringify(data));
  }

  return extractTextFromChatResponse(data);
}

function buildMasterPromptStage1({
  businessLocation,
  jobDetails,
  hourlyRate,
  labourMarkup,
  materialMarkup,
  preferredSuppliers
}) {
  return `
BUILDING ESTIMATING + PRICING MASTER PROMPT

You are my professional building estimating assistant. Internally analyse local building rules, standard practice, environmental exposure, durability requirements, and realistic construction methods based on the business location and job location — but do not display this internal analysis.

PROJECT DETAILS
${jobDetails}

BUSINESS INPUTS
Business Location: ${businessLocation}
Hourly Rate: ${hourlyRate}
Labour Mark Up %: ${labourMarkup}
Material Mark Up %: ${materialMarkup}
Preferred Suppliers: ${preferredSuppliers}

ENVIRONMENTAL CONTEXT
Use the business/job location to assess climate, coastal exposure, salt air, wind, humidity, rainfall, corrosion risk, frost zones, and durability requirements. Use this to select correct fixings, timber treatments, and suitable materials.

STAGE 1 — CLARIFICATION MODE

Before producing any output, internally review:
- Job scope
- Measurements
- Site conditions
- Access
- Ground conditions
- Existing structures
- Materials/spec choices
- Finish expectations
- Compliance/durability needs
- Labour difficulty
- Any missing information that would change the final price

STAGE 1 OUTPUT RULES

Return ONLY clarification questions.

You MUST ask between 5 and 10 questions.
Do not ask fewer than 5 questions.
Do not ask more than 10 questions.

Do NOT write a heading.
Do NOT write "Clarification questions:".
Do NOT write an intro sentence.
Do NOT write assumptions.
Do NOT write pricing.
Do NOT write materials.
Do NOT write totals.
Do NOT write a summary.

Each question must:
- Be numbered
- Be on its own line
- Be specific to this job
- Help improve pricing accuracy

Output example format:

1. What is the total square metre area of the deck?
2. What height will the deck be above ground level?
3. Is the site coastal, exposed, or subject to high wind?
4. What decking material would you like priced?
5. Is access easy for carrying materials and digging footings?
`.trim();
}

function buildMasterPromptStage2({
  businessLocation,
  jobDetails,
  hourlyRate,
  labourMarkup,
  materialMarkup,
  preferredSuppliers,
  clarificationAnswers
}) {
  return `
BUILDING ESTIMATING + PRICING MASTER PROMPT

You are my professional building estimating assistant. Internally analyse local building rules, standard practice, environmental exposure, durability requirements, and realistic construction methods based on the business location and job location — but do not display this internal analysis.

PROJECT DETAILS
${jobDetails}

BUSINESS INPUTS
Business Location: ${businessLocation}
Hourly Rate: ${hourlyRate}
Labour Mark Up %: ${labourMarkup}
Material Mark Up %: ${materialMarkup}
Preferred Suppliers: ${preferredSuppliers}

CLARIFICATION ANSWERS
${clarificationAnswers}

ENVIRONMENTAL CONTEXT
Use the business/job location to assess climate, coastal exposure, salt air, wind, humidity, rainfall, corrosion risk, frost zones, and durability requirements. Use this to select correct fixings, timber treatments, and suitable materials.

STAGE 2 — PRICING MODE

Use only confirmed data, user answers, and sensible local residential construction assumptions.

REQUIRED METHOD

1) Normalise Materials
Convert to purchasable units.
Round up to full packs, lengths, bags, sheets, boxes, or standard supplier units.
Add +5% timber waste buffer to timber only, then round again.

2) Supplier Pricing Order
Use this supplier order:
${preferredSuppliers} → other local suppliers → web search last

Choose the lowest compliant equivalent.
Note substitutions clearly.
Timber treatment and product specs must match requirements.
No downgrades.

3) Materials Pricing Table

Return ONE clean markdown table.

Use this exact table format:

| Category | Item | Spec/Size | Qty | Unit | Supplier | Product Name | Unit Price | Line Total | Link | Notes |
|---|---|---|---|---|---|---|---|---|---|---|

Rules:
- Every material must be its own row.
- Do NOT output the materials as a paragraph.
- Do NOT merge all materials into one block of text.
- Keep product names short and readable.
- Use clear quantities.
- Every priced line should include a product link where possible.
- If price is not found, write NOT FOUND.

4) Labour Breakdown

Return labour as a markdown table.

Use this exact table format:

| Task | Estimated Hours | Rate | Markup | Line Total | Notes |
|---|---:|---:|---:|---:|---|

Include practical trade tasks that suit the job.
The labour hours must add up correctly.
Labour = hours × hourly rate.
Apply Labour Mark Up % to labour subtotal.

5) Cost Summary

Return cost summary as a markdown table.

Use this exact table format:

| Cost Item | Amount |
|---|---:|

Include:
- Materials subtotal
- Materials mark up amount
- Labour subtotal
- Labour mark up amount
- Subtotal before tax
- Tax amount
- FINAL TOTAL incl tax

FINAL OUTPUT STRUCTURE

Use this exact structure:

## Job Summary

Short plain English summary of the job.

## Assumptions Used

Numbered assumptions.

## Materials Breakdown

Markdown table only.

## Labour Breakdown

Markdown table only.

## Cost Summary

Markdown table only.

## Notes / Substitutions

Short bullet list.

OUTPUT FORMAT RULES

Currency must match business location.
Use 2 decimal places for money.
Use clean markdown formatting.
Use headings.
Use tables.
Do NOT output the final quote as one huge paragraph.
Do NOT apologise.
Do NOT include hidden/internal analysis.
`.trim();
}

function buildRevisionPrompt({
  businessLocation,
  jobDetails,
  hourlyRate,
  labourMarkup,
  materialMarkup,
  preferredSuppliers,
  latestQuote,
  editRequest
}) {
  return `
You are revising an existing building quote.

Use the same estimating logic as the original quote, including:
- business location
- hourly rate
- labour markup
- material markup
- supplier preferences
- realistic local building methods
- suitable environmental and durability requirements

BUSINESS INPUTS
Business Location: ${businessLocation}
Hourly Rate: ${hourlyRate}
Labour Mark Up %: ${labourMarkup}
Material Mark Up %: ${materialMarkup}
Preferred Suppliers: ${preferredSuppliers}

ORIGINAL JOB DETAILS
${jobDetails}

CURRENT QUOTE
${latestQuote}

USER CHANGES REQUESTED
${editRequest}

Revise the full quote.
Return the complete updated quote, not just a summary.
Recalculate totals fully.

Use this exact structure:

## Job Summary

## Assumptions Used

## Materials Breakdown

Use a markdown table:
| Category | Item | Spec/Size | Qty | Unit | Supplier | Product Name | Unit Price | Line Total | Link | Notes |
|---|---|---|---|---|---|---|---|---|---|---|

## Labour Breakdown

Use a markdown table:
| Task | Estimated Hours | Rate | Markup | Line Total | Notes |
|---|---:|---:|---:|---:|---|

## Cost Summary

Use a markdown table:
| Cost Item | Amount |
|---|---:|

## What Changed

Currency must match business location.
Use 2 decimal places.
Do NOT output the quote as one huge paragraph.
`.trim();
}

function parseStage1Output(text) {
  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const questions = [];

  for (const line of lines) {
    const lower = line.toLowerCase();

    if (
      lower.includes('clarification questions') ||
      lower.includes('assumptions used') ||
      lower.includes('here are') ||
      lower.includes('before i can') ||
      lower.includes('i need')
    ) {
      continue;
    }

    const clean = line
      .replace(/^[-*\d.)\s]+/, '')
      .replace(/^question\s*\d+\s*[:.)-]\s*/i, '')
      .trim();

    if (!clean) continue;

    questions.push(clean);
  }

  return {
    followUpQuestions: questions.slice(0, 10),
    assumptions: []
  };
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
  const today = getTodayKey();

  const { count, error } = await supabase
    .from('tool_usage_logs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('usage_date', today);

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
  if (!creditsToDeduct || creditsToDeduct <= 0) return;

  const profile = await getProfile(userId);
  if (!profile) {
    throw new Error('Profile not found');
  }

  const currentCredits = Number(profile.credits || 0);
  if (currentCredits < creditsToDeduct) {
    throw new Error(`Not enough credits. You need ${creditsToDeduct} credits.`);
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

async function enforceUsageLimits(body, mode) {
  const userId = safeText(body.user_id);
  const toolCost = TOOL_COSTS[mode] ?? TOOL_COSTS.generate;

  if (!userId) {
    throw new Error('Missing user_id');
  }

  const profile = await getProfile(userId);
  if (!profile) {
    throw new Error('Profile not found');
  }

  const currentCredits = Number(profile.credits || 0);
  if (currentCredits < toolCost) {
    throw new Error(`Not enough credits. You need ${toolCost} credits.`);
  }

  const todayUsageCount = await getTodayUsageCount(userId);
  if (todayUsageCount >= DAILY_RUN_LIMIT) {
    throw new Error(`Daily usage limit reached. Max ${DAILY_RUN_LIMIT} runs per day.`);
  }

  return {
    userId,
    toolCost
  };
}

async function handleGenerate(req, res, body) {
  const businessLocation = safeText(body.location);
  const jobDetails = safeText(body.jobDetails);
  const hourlyRate = safeText(body.hourlyRate);
  const labourMarkup = safeText(body.markup);
  const materialMarkup = safeText(body.materialBuffer);
  const preferredSuppliers = safeText(body.preferredSuppliers);

  if (!businessLocation || !jobDetails || !hourlyRate || !labourMarkup || !materialMarkup || !preferredSuppliers) {
    return json(res, 400, { error: 'Missing required fields' });
  }

  const { userId, toolCost } = await enforceUsageLimits(body, 'generate');

  const prompt = buildMasterPromptStage1({
    businessLocation,
    jobDetails,
    hourlyRate,
    labourMarkup,
    materialMarkup,
    preferredSuppliers
  });

  const text = await openAIChat([{ role: 'user', content: prompt }]);

  await deductCredits(userId, toolCost);
  await logUsage({ userId, mode: 'generate', creditsUsed: toolCost });

  const parsed = parseStage1Output(text);

  return json(res, 200, {
    followUpQuestions: parsed.followUpQuestions,
    assumptions: parsed.assumptions,
    raw: text
  });
}

async function handleClarificationAnswers(req, res, body) {
  const businessLocation = safeText(body.location);
  const jobDetails = safeText(body.jobDetails);
  const hourlyRate = safeText(body.hourlyRate);
  const labourMarkup = safeText(body.markup);
  const materialMarkup = safeText(body.materialBuffer);
  const preferredSuppliers = safeText(body.preferredSuppliers);
  const answerMap = Array.isArray(body.answerMap) ? body.answerMap : [];

  if (!businessLocation || !jobDetails || !hourlyRate || !labourMarkup || !materialMarkup || !preferredSuppliers) {
    return json(res, 400, { error: 'Missing required fields' });
  }

  const clarificationAnswers = answerMap
    .filter(item => item && item.question && item.answer)
    .map((item, index) => `Question ${index + 1}: ${item.question}\nAnswer ${index + 1}: ${item.answer}`)
    .join('\n\n');

  const prompt = buildMasterPromptStage2({
    businessLocation,
    jobDetails,
    hourlyRate,
    labourMarkup,
    materialMarkup,
    preferredSuppliers,
    clarificationAnswers: clarificationAnswers || 'No clarification answers provided'
  });

  const text = await openAIChat([{ role: 'user', content: prompt }]);

  return json(res, 200, { result: text || 'Final quote generated.' });
}

async function handleReviseQuote(req, res, body) {
  const businessLocation = safeText(body.location);
  const jobDetails = safeText(body.jobDetails);
  const hourlyRate = safeText(body.hourlyRate);
  const labourMarkup = safeText(body.markup);
  const materialMarkup = safeText(body.materialBuffer);
  const preferredSuppliers = safeText(body.preferredSuppliers);
  const latestQuote = safeText(body.latestQuote);
  const editRequest = safeText(body.editRequest);

  if (!businessLocation || !jobDetails || !latestQuote || !editRequest) {
    return json(res, 400, { error: 'Missing required fields for quote revision' });
  }

  const prompt = buildRevisionPrompt({
    businessLocation,
    jobDetails,
    hourlyRate,
    labourMarkup,
    materialMarkup,
    preferredSuppliers,
    latestQuote,
    editRequest
  });

  const text = await openAIChat([{ role: 'user', content: prompt }]);

  return json(res, 200, { result: text || 'Quote revised.' });
}

async function handleSavePrompt(req, res, body) {
  const { user_id, promptData } = body || {};

  if (!user_id) {
    return json(res, 400, { error: 'Missing user_id' });
  }

  const { data, error } = await supabase
    .from('master_quote_prompts')
    .upsert(
      {
        user_id,
        prompt_data: promptData || null
      },
      { onConflict: 'user_id' }
    )
    .select();

  if (error) {
    return json(res, 500, { error: error.message });
  }

  return json(res, 200, {
    success: true,
    message: 'Prompt saved successfully',
    data
  });
}

async function handleLoadPrompt(req, res, body) {
  const { user_id } = body || {};

  if (!user_id) {
    return json(res, 400, { error: 'Missing user_id' });
  }

  const { data, error } = await supabase
    .from('master_quote_prompts')
    .select('*')
    .eq('user_id', user_id)
    .maybeSingle();

  if (error) {
    return json(res, 500, { error: error.message });
  }

  return json(res, 200, {
    success: true,
    data: data || null
  });
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
    const mode = safeText(body.mode);

    if (mode === 'savePrompt') return await handleSavePrompt(req, res, body);
    if (mode === 'loadPrompt') return await handleLoadPrompt(req, res, body);
    if (mode === 'generate' || !mode) return await handleGenerate(req, res, body);
    if (mode === 'clarification_answers') return await handleClarificationAnswers(req, res, body);
    if (mode === 'revise_quote') return await handleReviseQuote(req, res, body);

    return json(res, 400, { error: 'Invalid mode' });
  } catch (error) {
    return json(res, 500, {
      error: error.message || 'Something went wrong generating the quote'
    });
  }
}
