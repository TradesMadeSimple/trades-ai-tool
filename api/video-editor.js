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
  const response = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=*`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });

  const data = await response.json();
  return Array.isArray(data) ? data[0] : null;
}

async function updateCredits(userId, newCredits) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ credits: newCredits }),
  });

  if (!response.ok) throw new Error("Could not update credits.");

  const data = await response.json();
  return Array.isArray(data) ? data[0] : null;
}

async function createVideoJob({ userId, clipPaths, referencePath }) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/video_jobs`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      user_id: userId,
      status: "queued",
      clip_paths: clipPaths,
      reference_path: referencePath,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Could not create video job.");
  }

  return Array.isArray(data) ? data[0] : null;
}

function isUnlimitedPlan(plan) {
  return false;
}

export default async function handler(req, res) {
  cors(res);

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing Supabase environment variables.");
    }

    const body = req.body || {};
    const { user_id, clip_paths, reference_path } = body;

    if (!user_id) return sendJson(res, 400, { error: "Missing user_id." });

    if (!Array.isArray(clip_paths) || clip_paths.length < 1) {
      return sendJson(res, 400, { error: "Missing video clips." });
    }

    if (!reference_path) {
      return sendJson(res, 400, { error: "Missing reference video." });
    }

    const profile = await getProfile(user_id);

    if (!profile) return sendJson(res, 404, { error: "Profile not found." });

    const unlimited = isUnlimitedPlan(profile.plan);
    const currentCredits = Number(profile.credits || 0);

    if (!unlimited && currentCredits < VIDEO_EDITOR_CREDIT_COST) {
      return sendJson(res, 402, { error: "Not enough credits." });
    }

    const job = await createVideoJob({
      userId: user_id,
      clipPaths: clip_paths,
      referencePath: reference_path,
    });

    let updatedProfile = profile;

    if (!unlimited) {
      updatedProfile = await updateCredits(user_id, currentCredits - VIDEO_EDITOR_CREDIT_COST);
    }

    return sendJson(res, 200, {
      success: true,
      status: "queued",
      message: "Video job created successfully.",
      job_id: job?.id,
      result: {
        preview_message: "Video job queued. Real video processing will be connected next.",
        job,
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
