import express from "express";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const app = express();
const PORT = process.env.PORT || 3000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TEMP_BUCKET = "video-editor-temp";
const OUTPUT_BUCKET = "video-editor-outputs";

app.use(express.json({ limit: "10mb" }));

function supabaseHeaders(contentType = "application/json") {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...(contentType ? { "Content-Type": contentType } : {}),
  };
}

async function getQueuedJob() {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/video_jobs?status=eq.queued&select=*&order=created_at.asc&limit=1`,
    { headers: supabaseHeaders() }
  );

  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Could not fetch queued jobs.");

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
  if (!response.ok) throw new Error(data.message || "Could not update video job.");

  return Array.isArray(data) ? data[0] : null;
}

async function downloadStorageFile(bucket, storagePath, localPath) {
  const encodedPath = storagePath.split("/").map(encodeURIComponent).join("/");

  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${bucket}/${encodedPath}`,
    {
      headers: supabaseHeaders(null),
    }
  );

  if (!response.ok) {
    throw new Error(`Could not download ${storagePath}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(localPath, buffer);
}

async function uploadOutputFile(storagePath, localPath) {
  const fileBuffer = await fs.readFile(localPath);
  const encodedPath = storagePath.split("/").map(encodeURIComponent).join("/");

  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${OUTPUT_BUCKET}/${encodedPath}`,
    {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "video/mp4",
        "x-upsert": "true",
      },
      body: fileBuffer,
    }
  );

  const data = await response.text();

  if (!response.ok) {
    throw new Error(data || "Could not upload output video.");
  }
}

async function renderBasicReel(inputFiles, outputFile) {
  const listPath = path.join(path.dirname(outputFile), "inputs.txt");

  const listContent = inputFiles
    .map((file) => `file '${file.replace(/'/g, "'\\''")}'`)
    .join("\n");

  await fs.writeFile(listPath, listContent);

  const joinedPath = path.join(path.dirname(outputFile), "joined.mp4");

  await execFileAsync("ffmpeg", [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", listPath,
    "-c", "copy",
    joinedPath,
  ]);

  await execFileAsync("ffmpeg", [
    "-y",
    "-i", joinedPath,
    "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
    "-r", "30",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "23",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    outputFile,
  ]);
}

async function processNextJob() {
  const job = await getQueuedJob();

  if (!job) {
    return {
      success: true,
      message: "No queued jobs found.",
    };
  }

  await updateJob(job.id, { status: "processing" });

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `video-job-${job.id}-`));

  try {
    const localClipFiles = [];

    for (let i = 0; i < job.clip_paths.length; i++) {
      const localPath = path.join(workDir, `clip-${i}.mp4`);
      await downloadStorageFile(TEMP_BUCKET, job.clip_paths[i], localPath);
      localClipFiles.push(localPath);
    }

    const outputFile = path.join(workDir, "final-reel.mp4");

    await renderBasicReel(localClipFiles, outputFile);

    const outputPath = `${job.user_id}/${job.id}/final-reel.mp4`;

    await uploadOutputFile(outputPath, outputFile);

    await updateJob(job.id, {
      status: "completed",
      output_path: outputPath,
      error_message: null,
    });

    return {
      success: true,
      message: "Video rendered successfully.",
      job_id: job.id,
      output_path: outputPath,
    };
  } catch (error) {
    await updateJob(job.id, {
      status: "failed",
      error_message: error.message || "Video processing failed.",
    });

    throw error;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
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
