const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const EMAIL_ASSISTANT_CREDIT_COST = 1;

function sendJson(res, status, data) {
  res.status(status).json(data);
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function getProfile(userId) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=*`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );

  const data = await response.json();
  return Array.isArray(data) ? data[0] : null;
}

async function updateCredits(userId, newCredits) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`,
    {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ credits: newCredits }),
    }
  );

  if (!response.ok) {
    throw new Error("Could not update credits.");
  }

  const data = await response.json();
  return Array.isArray(data) ? data[0] : null;
}

function isUnlimitedPlan(plan) {
  const p = String(plan || "").toLowerCase();
  return p.includes("unlimited") || p.includes("business");
}

function formatExamples(writingExamples) {
  if (!Array.isArray(writingExamples) || !writingExamples.length) {
    return "No saved writing examples provided.";
  }

  return writingExamples
    .filter(Boolean)
    .slice(0, 5)
    .map((example, index) => `Example ${index + 1}:\n${example}`)
    .join("\n\n");
}

function buildGeneratePrompt({ customerEmail, replyBrief, writingExamples }) {
  const examplesText = formatExamples(writingExamples);
  const replyInstruction =
    replyBrief && String(replyBrief).trim()
      ? replyBrief
      : "Write the best natural professional reply based on the customer's email.";

  return `
You are an email assistant for a trade or construction business.

Write a clear, natural customer email reply.

Use the customer's saved writing examples to match their style if examples are provided.
Do not copy the examples word for word.

Important writing rules:
Never use hyphens, en dashes, or em dashes.
Sound human and natural.
Do not sound cringe, overly excited, fake, corporate, or robotic.
Keep the wording simple, like a real trade business owner replying to a customer.
Do not add made up prices, dates, promises, site visit times, or job details.
Only include what the user asked you to say.
Do not add a price unless the user included one.
Keep it professional, friendly, and clear.
Do not over explain.
Do not use headings.
Do not add a subject line.
Do not use bullet points unless the user clearly asks for them.
Format it like a real email with line breaks.
Use one greeting line, then a blank line, then the body, then a blank line, then the sign off, then the name if a name is naturally included.
Do not return the full email in one paragraph.

Saved writing examples:
${examplesText}

Customer email:
${customerEmail}

What the user wants to say:
${replyInstruction}

Return only the email reply.
`;
}

function buildRewritePrompt({
  action,
  customerEmail,
  replyBrief,
  currentDraft,
  writingExamples,
}) {
  const examplesText = formatExamples(writingExamples);

  const actionMap = {
    warmer: "Make the reply warmer and friendlier without making it fake or too long.",
    firmer: "Make the reply firmer and more direct, while still being professional.",
    shorter: "Shorten the reply while keeping the key message.",
    longer: "Make the reply longer and more helpful, but do not add prices or made up details.",
    from_edits: "Improve the user's edited reply while keeping their changes, meaning, and wording style.",
  };

  return `
You are an email assistant for a trade or construction business.

Task:
${actionMap[action] || actionMap.from_edits}

Important writing rules:
Never use hyphens, en dashes, or em dashes.
Sound human and natural.
Do not sound cringe, overly excited, fake, corporate, or robotic.
Keep the wording simple, like a real trade business owner replying to a customer.
Keep the meaning of the current draft.
Match the user's writing style if examples are provided.
Do not add made up prices, dates, promises, site visit times, or job details.
Do not add a price unless the user already included one.
Do not over explain.
Do not use headings.
Do not add a subject line.
Do not use bullet points unless the current draft already uses them.
Format it like a real email with line breaks.
Use one greeting line, then a blank line, then the body, then a blank line, then the sign off, then the name if a name is naturally included.
Do not return the full email in one paragraph.

Saved writing examples:
${examplesText}

Original customer email:
${customerEmail || "Not provided"}

Original instruction from user:
${replyBrief || "Not provided"}

Current draft:
${currentDraft}

Return only the improved email reply.
`;
}

async function callOpenAI(prompt) {
  if (!OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY.");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5.4-mini",
      input: [
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || "OpenAI request failed.");
  }

  const directText = data.output_text || "";

  const nestedText = Array.isArray(data.output)
    ? data.output
        .flatMap((item) => item.content || [])
        .map((part) => part.text || "")
        .join("")
    : "";

  const finalText = (directText || nestedText || "").trim();

  if (!finalText) {
    throw new Error("AI returned no text.");
  }

  return finalText;
}

export default async function handler(req, res) {
  cors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing Supabase environment variables.");
    }

    const body = req.body || {};
    const {
      user_id,
      mode,
      customerEmail,
      replyBrief,
      writingExamples,
      currentDraft,
      action,
    } = body;

    if (!user_id) {
      return sendJson(res, 400, { error: "Missing user_id." });
    }

    if (!mode) {
      return sendJson(res, 400, { error: "Missing mode." });
    }

    const profile = await getProfile(user_id);

    if (!profile) {
      return sendJson(res, 404, { error: "Profile not found." });
    }

    const unlimited = isUnlimitedPlan(profile.plan);
    const currentCredits = Number(profile.credits || 0);

    if (!unlimited && currentCredits < EMAIL_ASSISTANT_CREDIT_COST) {
      return sendJson(res, 402, { error: "Not enough credits." });
    }

    let prompt = "";

    if (mode === "generate_email_reply") {
      if (!customerEmail) {
        return sendJson(res, 400, {
          error: "Missing customer email.",
        });
      }

      prompt = buildGeneratePrompt({
        customerEmail,
        replyBrief,
        writingExamples,
      });
    } else if (mode === "rewrite_email_reply") {
      if (!currentDraft) {
        return sendJson(res, 400, { error: "Missing current draft." });
      }

      prompt = buildRewritePrompt({
        action,
        customerEmail,
        replyBrief,
        currentDraft,
        writingExamples,
      });
    } else {
      return sendJson(res, 400, { error: "Invalid mode." });
    }

    const reply = await callOpenAI(prompt);

    let updatedProfile = profile;

    if (!unlimited) {
      updatedProfile = await updateCredits(
        user_id,
        currentCredits - EMAIL_ASSISTANT_CREDIT_COST
      );
    }

    return sendJson(res, 200, {
      success: true,
      result: reply,
      reply,
      credits: updatedProfile?.credits ?? profile.credits,
      plan: updatedProfile?.plan ?? profile.plan,
    });
  } catch (error) {
    return sendJson(res, 500, {
      error: error.message || "Something went wrong.",
    });
  }
}
