window.uploadEvidence = async function uploadEvidence(propertyId, imageFiles, docFiles) {
  if (!propertyId) {
    throw new Error('Property ID is required for uploads.');
  }

  const SUPABASE_URL = window.SUPABASE_URL;
  const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Supabase credentials are missing in the browser.');
  }

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  async function uploadFiles(files, folder) {
    const uploadedUrls = [];

    for (const file of files) {
      const filePath = `${folder}/${propertyId}/${Date.now()}-${file.name}`;

      const { error: uploadError } = await supabase.storage
        .from('property-files')
        .upload(filePath, file);

      if (uploadError) {
        throw new Error(uploadError.message);
      }

      const { data } = supabase.storage
        .from('property-files')
        .getPublicUrl(filePath);

      uploadedUrls.push(data.publicUrl);
    }

    return uploadedUrls;
  }

  const imageUrls = imageFiles?.length ? await uploadFiles(imageFiles, 'images') : [];
  const documentUrls = docFiles?.length ? await uploadFiles(docFiles, 'documents') : [];

  const updatePayload = {};
  if (imageUrls.length) updatePayload.images = imageUrls;
  if (documentUrls.length) updatePayload.documents = documentUrls;

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
    imageUrls,
    documentUrls
  };
};
