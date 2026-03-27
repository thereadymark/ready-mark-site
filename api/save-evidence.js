(function () {
  function getSupabaseClient() {
    const SUPABASE_URL = window.SUPABASE_URL;
    const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY;

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error('Supabase browser credentials are missing.');
    }

    if (!window.supabase || !window.supabase.createClient) {
      throw new Error('Supabase client library did not load.');
    }

    return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }

  async function uploadSingleFile(supabase, bucketName, filePath, file) {
    const { error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(filePath, file, {
        upsert: false
      });

    if (uploadError) {
      throw new Error(uploadError.message);
    }

    const { data } = supabase.storage
      .from(bucketName)
      .getPublicUrl(filePath);

    return data.publicUrl;
  }

  async function uploadMultipleFiles(supabase, bucketName, files, folderPrefix) {
    const uploadedUrls = [];

    for (const file of files) {
      const safeName = file.name.replace(/\s+/g, '-');
      const filePath = `${folderPrefix}/${Date.now()}-${safeName}`;
      const url = await uploadSingleFile(supabase, bucketName, filePath, file);
      uploadedUrls.push(url);
    }

    return uploadedUrls;
  }

  window.saveEvidenceFiles = async function saveEvidenceFiles(propertyId, photoFiles, documentFiles) {
    if (!propertyId) {
      throw new Error('Property ID is required before uploading files.');
    }

    const supabase = getSupabaseClient();

    const photoUrls = photoFiles && photoFiles.length
      ? await uploadMultipleFiles(supabase, 'property-files', photoFiles, `properties/${propertyId}/photos`)
      : [];

    const documentUrls = documentFiles && documentFiles.length
      ? await uploadMultipleFiles(supabase, 'property-files', documentFiles, `properties/${propertyId}/documents`)
      : [];

    const updatePayload = {};

    if (photoUrls.length) {
      updatePayload.photo_urls = photoUrls;
    }

    if (documentUrls.length) {
      updatePayload.document_urls = documentUrls;
    }

    if (Object.keys(updatePayload).length > 0) {
      const { error } = await supabase
        .from('properties')
        .update(updatePayload)
        .eq('id', propertyId);

      if (error) {
        throw new Error(error.message);
      }
    }

    return {
      photoUrls,
      documentUrls
    };
  };

  window.saveInspectionEvidence = async function saveInspectionEvidence(propertyId, inspectionPhoto, inspectionLog) {
    if (!propertyId) {
      throw new Error('Property ID is required.');
    }

    const supabase = getSupabaseClient();

    let photoUrl = null;

    if (inspectionPhoto) {
      const safeName = inspectionPhoto.name.replace(/\s+/g, '-');
      const filePath = `inspections/${propertyId}/${Date.now()}-${safeName}`;

      photoUrl = await uploadSingleFile(
        supabase,
        'property-files',
        filePath,
        inspectionPhoto
      );
    }

    const insertPayload = {
      property_id: propertyId,
      photo_url: photoUrl,
      log: inspectionLog || ''
    };

    const { error } = await supabase
      .from('inspections')
      .insert([insertPayload]);

    if (error) {
      throw new Error(error.message);
    }

    return {
      property_id: propertyId,
      photo_url: photoUrl,
      log: inspectionLog || ''
    };
  };
})();
