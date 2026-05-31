import { supabase } from './supabase'

const BUCKET = import.meta.env.VITE_SUPABASE_STORAGE_BUCKET || 'amaroo-photos'
const DOCUMENT_BUCKET = import.meta.env.VITE_SUPABASE_DOCUMENTS_BUCKET || BUCKET
const MAX_BYTES = 10 * 1024 * 1024
const MAX_PX = 1920
const ALLOWED = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
const STORAGE_REF_PREFIX = 'storage://'

export function validatePhoto(file) {
  const type = file.type.toLowerCase()
  const ext = file.name.split('.').pop().toLowerCase()
  if (!ALLOWED.has(type) && !['heic', 'heif'].includes(ext)) {
    return 'Only JPEG, PNG, WebP, or HEIC images are allowed.'
  }
  if (file.size > MAX_BYTES) {
    return `"${file.name}" exceeds the 10 MB limit.`
  }
  return null
}

export function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_')
}

export function makeStorageReference(bucket, path) {
  return `${STORAGE_REF_PREFIX}${bucket}/${path}`
}

export function parseStorageReference(value) {
  if (typeof value !== 'string' || !value.startsWith(STORAGE_REF_PREFIX)) return null
  const withoutPrefix = value.slice(STORAGE_REF_PREFIX.length)
  const slashIndex = withoutPrefix.indexOf('/')
  if (slashIndex === -1) return null
  return {
    bucket: withoutPrefix.slice(0, slashIndex),
    path: withoutPrefix.slice(slashIndex + 1),
  }
}

async function compress(file) {
  return new Promise((resolve) => {
    const img = new Image()
    const objUrl = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(objUrl)
      let w = img.naturalWidth
      let h = img.naturalHeight
      if (w > MAX_PX || h > MAX_PX) {
        if (w >= h) { h = Math.round(h * MAX_PX / w); w = MAX_PX }
        else { w = Math.round(w * MAX_PX / h); h = MAX_PX }
      }
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      canvas.toBlob(
        (blob) => resolve(blob || file),
        'image/jpeg',
        0.85,
      )
    }
    img.onerror = () => { URL.revokeObjectURL(objUrl); resolve(file) }
    img.src = objUrl
  })
}

export async function uploadPhoto(file, storagePath) {
  let blob
  try {
    blob = await compress(file)
  } catch (compressErr) {
    console.warn('[storage] compress failed, using original file:', compressErr)
    blob = file
  }

  console.log(`[storage] uploading to bucket="${BUCKET}" path="${storagePath}"`)
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, blob, { contentType: 'image/jpeg', upsert: false })

  if (error) {
    console.error('[storage] upload error:', error)
    throw error
  }

  const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(data.path)
  return { url: publicUrl, path: data.path }
}

export async function uploadDocument(file, storagePath) {
  const { data, error } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .upload(storagePath, file, { contentType: file.type || 'application/octet-stream', upsert: false })

  if (error) {
    console.error('[storage] document upload error:', error)
    throw error
  }

  return {
    bucket: DOCUMENT_BUCKET,
    path: data.path,
    reference: makeStorageReference(DOCUMENT_BUCKET, data.path),
  }
}

export async function downloadStoredFile(reference) {
  const parsed = parseStorageReference(reference)
  if (!parsed) throw new Error('Invalid storage reference.')
  const { data, error } = await supabase.storage.from(parsed.bucket).download(parsed.path)
  if (error) {
    console.error('[storage] download error:', error)
    throw error
  }
  return data
}

export async function deleteStoredFile(reference) {
  const parsed = parseStorageReference(reference)
  if (!parsed) return
  const { error } = await supabase.storage.from(parsed.bucket).remove([parsed.path])
  if (error) {
    console.error('[storage] delete stored file error:', error)
    throw error
  }
}

export async function deletePhoto(storagePath) {
  if (!storagePath) return
  const { error } = await supabase.storage.from(BUCKET).remove([storagePath])
  if (error) {
    console.error('[storage] delete error:', error)
    throw error
  }
}

export function safePhotoUrl(photo) {
  return typeof photo === 'string' ? photo : photo?.url
}

export function safePhotoPath(photo) {
  return typeof photo === 'string' ? null : photo?.path
}
