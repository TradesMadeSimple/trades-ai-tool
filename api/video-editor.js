import formidable from "formidable";

export const config = {
  api: {
    bodyParser: false,
  },
};

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

function toSingle(value) {
  return Array.isArray(value) ? value[0] : value;
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

async function parseForm(req) {
  const form = formidable({
    multiples: true,
    maxFileSize: 250 * 1024 * 1024,
    maxTotalFileSize: 750 * 1024 * 1024,
    keepExtensions: true,
  });

  return new Promise((resolve, reject) => {
    form.parse(req, function (err, fields, files) {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
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

    const { fields, files } = await parseForm(req);

    const userId = toSingle(fields.user_id);
    const clips = toArray(files.clips);
    const reference = toSingle(files.reference);

    if (!userId) {
      return sendJson(res, 400, { error: "Missing user_id." });
    }

    if (!clips.length) {
      return sendJson(res, 400, { error: "Missing video clips." });
    }

    if (!reference) {
      return sendJson(res, 400, { error: "Missing reference video." });
    }

    const profile = await getProfile(userId);

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
        userId,
        currentCredits - VIDEO_EDITOR_CREDIT_COST
      );
    }

    return sendJson(res, 200, {
      success: true,
      status: "files_received",
      message: "Video files received successfully.",
      result: {
        preview_message:
          "Files received successfully. Real video processing will be connected next.",
        clip_count: clips.length,
        clips: clips.map((file) => ({
          name: file.originalFilename,
          size: file.size,
          type: file.mimetype,
        })),
        reference: {
          name: reference.originalFilename,
          size: reference.size,
          type: reference.mimetype,
        },
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
