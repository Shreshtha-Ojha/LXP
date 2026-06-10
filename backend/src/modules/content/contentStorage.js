// src/modules/content/contentStorage.js
//
// Thin wrapper around the Supabase Storage REST API for uploaded learning
// asset files (PDF / SCORM packages). Uses the service-role key so uploads
// bypass Supabase RLS — never expose SUPABASE_SERVICE_ROLE_KEY to clients.
//
// Configure via env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// SUPABASE_STORAGE_BUCKET (defaults to 'learning-content').

const DEFAULT_BUCKET = 'learning-content'

/** Upload a multer file buffer to `${tenantId}/${assetId}/...` and return its public URL. */
async function uploadAssetFile({ tenantId, assetId, file }) {
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET

  if (!supabaseUrl || !serviceRoleKey) {
    const err = new Error('Content storage is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)')
    err.status = 500
    throw err
  }

  const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_')
  const path = `${tenantId}/${assetId}/${Date.now()}-${safeName}`

  const response = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': file.mimetype || 'application/octet-stream',
      'x-upsert': 'true'
    },
    body: file.buffer
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    const err = new Error(`Failed to upload file to storage (${response.status}): ${detail}`)
    err.status = 502
    throw err
  }

  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}`
}

module.exports = { uploadAssetFile }
