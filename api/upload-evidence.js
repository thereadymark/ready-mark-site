import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '25mb',
    },
  },
};

function bufferFromBase64(base64String) {
  return Buffer.from(base64String, 'base64');
}

function sanitizeFileName(name) {
  return String(name || 'file')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '');
}

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
      photos,
      log_file
    } = req.body || {};

    if (!verification_id) {
      return res.status(400).json({ error: 'Missing verification_id' });
    }

    const uploadedPhotoUrls = [];
    let uploadedLogUrl = '';

    if (Array.isArray(photos) && photos.length > 0) {
      for (const photo of photos) {
        const fileName = sanitizeFileName(photo.name);
        const filePath = `${verification_id}/${Date.now()}-${fileName}`;
        const fileBuffer = bufferFromBase64(photo.base64);

        const { error: uploadError } = await supabase.storage
          .from('inspection-photos')
          .upload(filePath, fileBuffer, {
            contentType: photo.type || 'application/octet-stream',
            upsert: false
          });

        if (uploadError) {
          return res.status(500).json({
            error: `Photo upload failed: ${uploadError.message}`
          });
        }

        const { data } = supabase.storage
          .from('inspection-photos')
          .getPublicUrl(filePath);

        uploadedPhotoUrls.push(data.publicUrl);
      }
    }

    if (log_file && log_file.base64) {
      const fileName = sanitizeFileName(log_file.name);
      const filePath = `${verification_id}/log-${Date.now()}-${fileName}`;
      const fileBuffer = bufferFromBase64(log_file.base64);

      const { error: uploadError } = await supabase.storage
        .from('inspection-docs')
        .upload(filePath, fileBuffer, {
          contentType: log_file.type || 'application/octet-stream',
          upsert: false
        });

      if (uploadError) {
        return res.status(500).json({
          error: `Log upload failed: ${uploadError.message}`
        });
      }

      const { data } = supabase.storage
        .from('inspection-docs')
        .getPublicUrl(filePath);

      uploadedLogUrl = data.publicUrl;
    }

    const updatePayload = {};

    if (uploadedPhotoUrls.length) {
      updatePayload.photo_urls = uploadedPhotoUrls;
    }

    if (uploadedLogUrl) {
      updatePayload.log_file_url = uploadedLogUrl;
    }

    if (Object.keys(updatePayload).length > 0) {
      const { error: updateError } = await supabase
        .from('Inspections')
        .update(updatePayload)
        .eq('verification_id', verification_id);

      if (updateError) {
        return res.status(500).json({
          error: `Inspection update failed: ${updateError.message}`
        });
      }
    }

    return res.status(200).json({
      success: true,
      verification_id,
      photo_urls: uploadedPhotoUrls,
      log_file_url: uploadedLogUrl
    });
  } catch (error) {
    return res.status(500).json({
      error: `Server error: ${error.message}`
    });
  }
}
