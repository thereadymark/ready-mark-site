let existingPhotoUrls = [];
let inspectionRowId = null;

if (uploadedPhoto?.url || uploadedLog?.url) {
  const { data: existingRows, error: fetchError } = await supabase
    .from("inspections")
    .select("id, photo_urls")
    .eq("verification_id", verificationId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (fetchError) {
    return res.status(500).json({
      error: "Files uploaded, but existing inspection could not be checked.",
      details: fetchError.message,
      uploaded: {
        photo: uploadedPhoto,
        log: uploadedLog
      }
    });
  }

  const existingInspection = existingRows?.[0];

  if (!existingInspection?.id) {
    return res.status(404).json({
      error: "Files uploaded, but no matching inspection record was found.",
      verification_id: verificationId,
      uploaded: {
        photo: uploadedPhoto,
        log: uploadedLog
      }
    });
  }

  inspectionRowId = existingInspection.id;

  if (Array.isArray(existingInspection.photo_urls)) {
    existingPhotoUrls = existingInspection.photo_urls;
  }
}

const updatePayload = {};

if (uploadedPhoto?.url) {
  updatePayload.photo_url = uploadedPhoto.url;
  updatePayload.photo_urls = [...existingPhotoUrls, uploadedPhoto.url];
}

if (uploadedLog?.url) {
  updatePayload.log_file_url = uploadedLog.url;
}

if (Object.keys(updatePayload).length > 0) {
  const { error: updateError } = await supabase
    .from("inspections")
    .update(updatePayload)
    .eq("id", inspectionRowId);

  if (updateError) {
    return res.status(500).json({
      error: "Files uploaded, but inspection update failed.",
      details: updateError.message,
      uploaded: {
        photo: uploadedPhoto,
        log: uploadedLog
      }
    });
  }
}
