import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { jobDetails } = req.body;

    if (!jobDetails || !jobDetails.trim()) {
      return res.status(400).json({ error: "Job details are required." });
    }

    const prompt = `
You are a NZ trade business assistant.

Take the job details below and return:

Job Summary:
Likely Materials:
Missing Info:
Suggested Next Step:

Job Details:
${jobDetails}
`;

    const response = await client.responses.create({
      model: "gpt-5",
      input: prompt
    });

    return res.status(200).json({
      output: response.output_text
    });
  } catch (error) {
    return res.status(500).json({
      error: "Something went wrong"
    });
  }
}
