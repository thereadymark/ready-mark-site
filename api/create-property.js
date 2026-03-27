import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function generateQRCode(propertyId) {
  const verifyUrl = `https://yourdomain.com/verify/${propertyId}`;
  return `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(verifyUrl)}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      id,
      name,
      property_type,
      address,
      city,
      state,
      zip
    } = req.body;

    if (!name || !property_type) {
      return res.status(400).json({ error: 'Name and property_type are required.' });
    }

    let propertyRecord;

    if (id) {
      const { data, error } = await supabase
        .from('properties')
        .update({
          name,
          property_type,
          address,
          city,
          state,
          zip
        })
        .eq('id', id)
        .select()
        .single();

      if (error) {
        console.error('Update error:', error);
        return res.status(500).json({ error: error.message });
      }

      propertyRecord = data;
    } else {
      const { data, error } = await supabase
        .from('properties')
        .insert([
          {
            name,
            property_type,
            address,
            city,
            state,
            zip
          }
        ])
        .select()
        .single();

      if (error) {
        console.error('Insert error:', error);
        return res.status(500).json({ error: error.message });
      }

      propertyRecord = data;
    }

    const qrCode = generateQRCode(propertyRecord.id);

    const { data: updatedProperty, error: qrError } = await supabase
      .from('properties')
      .update({
        qr_code: qrCode
      })
      .eq('id', propertyRecord.id)
      .select()
      .single();

    if (qrError) {
      console.error('QR update error:', qrError);
      return res.status(500).json({ error: qrError.message });
    }

    return res.status(200).json({
      success: true,
      property: updatedProperty
    });
  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
