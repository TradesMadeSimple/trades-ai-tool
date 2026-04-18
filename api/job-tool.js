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
    const { location, jobDetails, hourlyRate } = req.body || {};

    if (!location || !jobDetails) {
      return res.status(400).json({
        error: 'Missing location or job details'
      });
    }

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: 'OPENAI_API_KEY is missing in Vercel environment variables'
      });
    }

    const prompt = `
Reply with exactly 3 short lines.

Location: ${location}
Hourly Rate: ${hourlyRate || 'missing'}
Job Details: ${jobDetails}
`;

    const openaiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-5.2',
        input: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    });

    const data = await openaiResponse.json();

    if (!openaiResponse.ok) {
      console.error('OpenAI API error:', data);
      return res.status(500).json({
        error: data?.error?.message || JSON.stringify(data)
      });
    }

    return res.status(200).json({
      result: data.output_text || JSON.stringify(data)
    });
  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({
      error: error.message || 'Something went wrong generating the quote'
    });
  }
}
