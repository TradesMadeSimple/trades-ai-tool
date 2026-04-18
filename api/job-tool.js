export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { location, jobDetails } = req.body || {};

    if (!location || !jobDetails) {
      return res.status(400).json({
        error: 'Missing location or job details'
      });
    }

    const prompt = `
You are my NZ building estimating assistant. Internally analyse NZ building rules, standard practice, environmental exposure, durability requirements, and realistic construction methods — but do not display this internal analysis.

PROJECT DETAILS (job input only)
Location: ${location}
${jobDetails}

ENVIRONMENTAL CONTEXT (internal use only)
Coastal location, salt air, wind exposure, high humidity/rainfall, elevated corrosion risk. Use this to select correct fixings, timber treatments and durability classes.

STAGE 1 — MATERIAL TAKEOFF MODE
Before producing any output you must internally complete:
Generate missing data using standard region residential assumptions
Produce up to 10 clarification questions if needed (show questions only)
Define ASSUMPTIONS (show concise list)
Perform compliance logic, code logic, fixing logic, materials calculations and build guide cross-checks internally (DO NOT show these)

STAGE 1 OUTPUT RULES
ONLY output:
1. Clarification questions (list only)
2. ASSUMPTIONS USED (short, factual)

Do NOT output materials, pricing, calculations or summaries.
Do NOT proceed until the user replies.
After answers are received automatically move to Stage 2.

STAGE 2 — PRICING MODE
Use only confirmed data and the generated materials list from Stage 1.

JOB DETAILS (auto filled from Stage 1)
Hourly rate: [ INPUT YOUR HOURLY RATE HERE ]
Labour hours: Estimate using NZ build norms if not supplied
Materials buffer: 20% default unless specified

REQUIRED METHOD
1) Normalise Materials
Convert to purchasable units, round up to full packs/lengths, add +5% timber waste buffer to timber only, round again.

2) Supplier Pricing Order (mandatory)
[ INPUT PREFERRED SUPPLIERS HERE ] → Other local suppliers → Web search last

Choose lowest compliant equivalent. Note substitutions clearly.
Timber treatment must match spec (no downgrades)

4) Pricing Table Output
Return ONE table with:
Category, Item, Spec/Size, Quantity (Adjusted), Unit, Supplier, Product name, Pack size/length, Unit price [ YOUR COUNTRY CURRENCY ], Line total, Link, Notes/Substitution

5) Labour + Totals
Labour = hours × rate
Materials subtotal = sum of lines
Apply materials buffer ONLY
Add GST 15%

FINAL OUTPUT MUST INCLUDE

Labour Breakdown (mandatory)
Short task breakdown with hours (must match total):
Set-out & levels
Excavation & footings
Framing install
Decking install
Finishing & tidy

Cost Summary
Materials subtotal
Materials buffer amount
Labour subtotal (no buffer)
Subtotal ex GST
GST
FINAL TOTAL incl GST

OUTPUT FORMAT RULES
Currency: [ YOUR COUNTRY CURRENCY ]
Money: 2 decimals
Every priced line must include a working product link

If price not found:
Unit price = NOT FOUND
Supplier = NOT FOUND
Suggest closest alternative

MATERIALS LIST TO PRICE: Generated automatically from Stage 1 output.
`;

    const openaiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-5-mini',
        input: prompt
      })
    });

    const data = await openaiResponse.json();

    if (!openaiResponse.ok) {
      console.error('OpenAI API error:', data);
      return res.status(500).json({
        error: data?.error?.message || 'OpenAI request failed'
      });
    }

    const result = data.output_text || 'No result returned';

    return res.status(200).json({ result });
  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({
      error: error.message || 'Something went wrong generating the quote'
    });
  }
}
