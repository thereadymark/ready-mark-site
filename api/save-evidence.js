import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      verification_id,
      photo_urls,
      log_file_url
    } = req.body;

    if (!verification_id) {
      return res.status(400).json({
        error: 'verification_id is required.'
      });
    }

    const updatePayload = {};

    if (Array.isArray(photo_urls)) {
      updatePayload.photo_urls = photo_urls;
    }

    if (typeof log_file_url === 'string') {
      updatePayload.log_file_url = log_file_url;
    }

    const { data, error } = await supabase
      .from('inspections')
      .update(updatePayload)
      .eq('verification_id', verification_id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({
        error: error.message
      });
    }

    return res.status(200).json({
      success: true,
      inspection: data
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
}
