import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

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

function safeNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
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

PROJECT DETAILS (job input only)
${jobDetails}

BUSINESS INPUTS
Business Location: ${businessLocation}
Hourly Rate: ${hourlyRate}
Labour Mark Up %: ${labourMarkup}
Material Mark Up %: ${materialMarkup}
Preferred Suppliers: ${preferredSuppliers}

ENVIRONMENTAL CONTEXT (internal use only)
Use the business/job location to assess climate, coastal exposure, salt air, wind, humidity, rainfall, corrosion risk, frost zones, and durability requirements. Use this to select correct fixings, timber treatments, and suitable materials.

STAGE 1 — MATERIAL TAKEOFF MODE
Before producing any output you must internally complete:
Generate missing data using standard residential assumptions for the project location
Produce up to 10 clarification questions if needed (show questions only)
Define ASSUMPTIONS (show concise list)
Perform compliance logic, code logic, fixing logic, materials calculations, and build guide cross checks internally (DO NOT show these)

STAGE 1 OUTPUT RULES
ONLY output:
Clarification questions (list only)
ASSUMPTIONS USED (short, factual)

Do NOT output materials, pricing, calculations, or summaries.
Do NOT proceed until the user replies.
After answers are received automatically move to Stage 2.
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

PROJECT DETAILS (job input only)
${jobDetails}

BUSINESS INPUTS
Business Location: ${businessLocation}
Hourly Rate: ${hourlyRate}
Labour Mark Up %: ${labourMarkup}
Material Mark Up %: ${materialMarkup}
Preferred Suppliers: ${preferredSuppliers}

CLARIFICATION ANSWERS
${clarificationAnswers}

ENVIRONMENTAL CONTEXT (internal use only)
Use the business/job location to assess climate, coastal exposure, salt air, wind, humidity, rainfall, corrosion risk, frost zones, and durability requirements. Use this to select correct fixings, timber treatments, and suitable materials.

STAGE 2 — PRICING MODE
Use only confirmed data and the generated materials list from Stage 1.

JOB DETAILS (auto filled from Stage 1)
Hourly Rate: ${hourlyRate}
Labour Mark Up %: ${labourMarkup}
Material Mark Up %: ${materialMarkup}
Labour hours: Estimate using standard local construction norms if not supplied.

REQUIRED METHOD
1) Normalise Materials
Convert to purchasable units, round up to full packs/lengths, add +5% timber waste buffer to timber only, then round again.

2) Supplier Pricing Order (mandatory)
Preferred Suppliers → Other local suppliers → Web search last
Choose lowest compliant equivalent. Note substitutions clearly.
Timber treatment and product specs must match requirements (no downgrades).

3) Pricing Table Output
Return ONE table with:
Category, Item, Spec/Size, Quantity (Adjusted), Unit, Supplier, Product Name, Pack Size/Length, Unit Price [LOCAL CURRENCY], Line Total, Link, Notes/Substitution

4) Labour + Totals
Labour = hours × hourly rate
Apply Labour Mark Up % to labour subtotal
Materials subtotal = sum of lines
Apply Material Mark Up % to materials subtotal
Add local tax / GST / VAT based on business location

FINAL OUTPUT MUST INCLUDE

Labour Breakdown (mandatory)
Short task breakdown with hours (must match total):
Set out & levels
Excavation & footings
Framing install
Main construction/install phase
Finishing & tidy

Cost Summary
Materials subtotal
Materials mark up amount
Labour subtotal
Labour mark up amount
Subtotal before tax
Tax amount
FINAL TOTAL incl tax

OUTPUT FORMAT RULES
Currency must match business location
Use 2 decimal places
Every priced line must include a working product link
If price not found:
Unit Price = NOT FOUND
Supplier = NOT FOUND
Suggest closest alternative

MATERIALS LIST TO PRICE
Generated automatically from Stage 1 output.
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
Keep the same structure:
- Job Summary
- Assumptions Used
- Materials Breakdown
- Labour Breakdown
- Cost Summary
- What Changed

Recalculate totals fully.
Currency must match business location.
Use 2 decimal places.
`.trim();
}

function parseStage1Output(text) {
  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const questions = [];
  const assumptions = [];
  let inAssumptions = false;

  for (const line of lines) {
    const lower = line.toLowerCase();

    if (lower.includes('assumptions used')) {
      inAssumptions = true;
      continue;
    }

    const clean = line.replace(/^[-*\d.)\s]+/, '').trim();
    if (!clean) continue;

    if (inAssumptions) {
      assumptions.push(clean);
    } else {
      questions.push(clean);
    }
  }

  return {
    followUpQuestions: questions.slice(0, 2),
    assumptions
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
    return json(res, 400, {
      error: 'Missing required fields'
    });
  }

  const prompt = buildMasterPromptStage1({
    businessLocation,
    jobDetails,
    hourlyRate,
    labourMarkup,
    materialMarkup,
    preferredSuppliers
  });

  const text = await openAIChat([
    {
      role: 'user',
      content: prompt
    }
  ]);

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
    return json(res, 400, {
      error: 'Missing required fields'
    });
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

  const text = await openAIChat([
    {
      role: 'user',
      content: prompt
    }
  ]);

  return json(res, 200, {
    result: text || 'Final quote generated.'
  });
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
    return json(res, 400, {
      error: 'Missing required fields for quote revision'
    });
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

  const text = await openAIChat([
    {
      role: 'user',
      content: prompt
    }
  ]);

  return json(res, 200, {
    result: text || 'Quote revised.'
  });
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

    if (mode === 'savePrompt') {
      return await handleSavePrompt(req, res, body);
    }

    if (mode === 'loadPrompt') {
      return await handleLoadPrompt(req, res, body);
    }

    if (mode === 'generate' || !mode) {
      return await handleGenerate(req, res, body);
    }

    if (mode === 'clarification_answers') {
      return await handleClarificationAnswers(req, res, body);
    }

    if (mode === 'revise_quote') {
      return await handleReviseQuote(req, res, body);
    }

    return json(res, 400, { error: 'Invalid mode' });
  } catch (error) {
    return json(res, 500, {
      error: error.message || 'Something went wrong generating the quote'
    });
  }
}
