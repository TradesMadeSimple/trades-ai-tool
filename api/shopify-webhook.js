import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_DB_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed')
  }

  try {
    const order = req.body

    const email = order.email || order.customer?.email
    const items = order.line_items || []

    if (!email) {
      return res.status(400).json({ error: 'No email found' })
    }

    let plan = 'free'
    let credits = 10

    items.forEach(item => {
      const title = (item.title || '').toLowerCase()

      if (title.includes('starter')) {
        plan = 'starter'
        credits = 100
      }

      if (title.includes('professional')) {
        plan = 'professional'
        credits = 300
      }

      if (title.includes('business')) {
        plan = 'business'
        credits = 999999
      }
    })

    const { error } = await supabase
      .from('profiles')
      .update({
        plan: plan,
        credits: credits,
        updated_at: new Date().toISOString()
      })
      .eq('email', email)

    if (error) throw error

    return res.status(200).json({
      success: true,
      email: email,
      plan: plan,
      credits: credits
    })

  } catch (err) {
    return res.status(500).json({
      error: err.message
    })
  }
}
