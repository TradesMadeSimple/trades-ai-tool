export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      message: 'Method not allowed'
    });
  }

  const { location, jobDetails } = req.body || {};

  if (!location || !jobDetails) {
    return res.status(400).json({
      message: 'Location and job details are required'
    });
  }

  return res.status(200).json({
    success: true,
    result: `ULTIMATE QUOTE TEST

Location:
${location}

Job Details:
${jobDetails}

This is just a test response from Vercel.
Your real Ultimate Quote prompt will go here next.`
  });
}
