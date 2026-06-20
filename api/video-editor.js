const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const VIDEO_EDITOR_CREDIT_COST = 8;

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
  return false;
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
    const { user_id, clip_count, has_reference } = body;

    if (!user_id) {
      return sendJson(res, 400, { error: "Missing user_id." });
    }

    if (!clip_count || Number(clip_count) < 1) {
      return sendJson(res, 400, { error: "Missing video clips." });
    }

    if (!has_reference) {
      return sendJson(res, 400, { error: "Missing reference video." });
    }

    const profile = await getProfile(user_id);

    if (!profile) {
      return sendJson(res, 404, { error: "Profile not found." });
    }

    const unlimited = isUnlimitedPlan(profile.plan);
    const currentCredits = Number(profile.credits || 0);

    if (!unlimited && currentCredits < VIDEO_EDITOR_CREDIT_COST) {
      return sendJson(res, 402, { error: "Not enough credits." });
    }

    let updatedProfile = profile;

    if (!unlimited) {
      updatedProfile = await updateCredits(
        user_id,
        currentCredits - VIDEO_EDITOR_CREDIT_COST
      );
    }

    return sendJson(res, 200, {
      success: true,
      status: "mock_generated",
      message: "Video editor backend connected successfully.",
      result: {
        preview_message: "Reel ready. Real video processing will be connected next.",
        clip_count: Number(clip_count),
        has_reference: true,
      },
      credits: updatedProfile?.credits ?? profile.credits,
      plan: updatedProfile?.plan ?? profile.plan,
    });
  } catch (error) {
    return sendJson(res, 500, {
      error: error.message || "Something went wrong.",
    });
  }
}
