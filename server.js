import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

app.use(express.json({ limit: "10mb" }));

function supabaseHeaders() {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };
}

async function getQueuedJob() {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/video_jobs?status=eq.queued&select=*&order=created_at.asc&limit=1`,
    {
      headers: supabaseHeaders(),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Could not fetch queued jobs.");
  }

  return Array.isArray(data) ? data[0] : null;
}

async function updateJob(jobId, updates) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/video_jobs?id=eq.${jobId}`,
    {
      method: "PATCH",
      headers: {
        ...supabaseHeaders(),
        Prefer: "return=representation",
      },
      body: JSON.stringify(updates),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Could not update video job.");
  }

  return Array.isArray(data) ? data[0] : null;
}

async function processNextJob() {
  const job = await getQueuedJob();

  if (!job) {
    return {
      success: true,
      message: "No queued jobs found.",
    };
  }

  await updateJob(job.id, {
    status: "processing",
  });

  console.log("Processing video job:", job.id);
  console.log("Clip paths:", job.clip_paths);
  console.log("Reference path:", job.reference_path);

  await updateJob(job.id, {
    status: "completed",
    output_path: "test-output-placeholder.mp4",
  });

  return {
    success: true,
    message: "Job processed successfully.",
    job_id: job.id,
  };
}

app.get("/", function (req, res) {
  res.json({
    success: true,
    message: "Trades AI Tool worker is running.",
  });
});

app.get("/health", function (req, res) {
  res.json({
    success: true,
    status: "healthy",
  });
});

app.get("/process-next-video-job", async function (req, res) {
  try {
    const result = await processNextJob();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message || "Something went wrong.",
    });
  }
});

app.listen(PORT, function () {
  console.log("Worker server running on port " + PORT);
});
