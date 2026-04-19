import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
    const {
      mode,
      user_id,
      location,
      jobDetails,
      hourlyRate,
      materialBuffer,
      promptData
    } = req.body || {};

    if (mode === 'savePrompt') {
      if (!user_id) {
        return res.status(400).json({ error: 'Missing user_id' });
      }

      const { data, error } = await supabase
        .from('master_quote_prompts')
        .upsert(
          {
            user_id,
            hourly_rate: hourlyRate || null,
            location: location || null,
            material_buffer: materialBuffer || null,
            prompt_data: promptData || null
          },
          { onConflict: 'user_id' }
        )
        .select();

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.status(200).json({
        success: true,
        message: 'Prompt saved successfully',
        data
      });
    }

    if (mode === 'loadPrompt') {
      if (!user_id) {
        return res.status(400).json({ error: 'Missing user_id' });
      }

      const { data, error } = await supabase
        .from('master_quote_prompts')
        .select('*')
        .eq('user_id', user_id)
        .maybeSingle();

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.status(200).json({
        success: true,
        data: data || null
      });
    }

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
Material Buffer: ${materialBuffer || 'missing'}
Job Details: ${jobDetails}
`;

    const openaiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
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
      return res.status(500).json({
        error: data?.error?.message || JSON.stringify(data)
      });
    }

    return res.status(200).json({
      result: data.output_text || JSON.stringify(data)
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || 'Something went wrong generating the quote'
    });
  }
}