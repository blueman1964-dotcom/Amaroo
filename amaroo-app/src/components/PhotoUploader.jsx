import { useRef } from 'react'
import { Camera, X } from 'lucide-react'
import { PhotoImg } from './PhotoGallery'

const MAX_PHOTOS = 5

export default function PhotoUploader({ photos = [], onAdd, onRemove, onThumbnailClick, maxPhotos = MAX_PHOTOS }) {
  const inputRef = useRef(null)

  const handleFiles = (e) => {
    const files = Array.from(e.target.files || [])
    if (files.length) onAdd(files)
    e.target.value = ''
  }

  const remaining = maxPhotos - photos.length

  return (
    <div>
      <div className="flex flex-wrap gap-2 mt-1">
        {photos.map((p, i) => (
          <div key={p.id ?? i} className="relative w-16 h-16 rounded-lg overflow-hidden border-2"
            style={{ borderColor: p.error ? '#ef4444' : '#e2e8f0' }}>

            {/* spinner overlay */}
            {p.uploading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40">
                <svg className="animate-spin w-5 h-5 text-white" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
              </div>
            )}

            <button
              type="button"
              className="block w-full h-full"
              onClick={() => !p.uploading && onThumbnailClick && onThumbnailClick(i)}
              disabled={p.uploading}
              aria-label="View photo"
            >
              <PhotoImg src={p.previewUrl || p.url} alt="" className="w-16 h-16" />
            </button>

            {!p.uploading && (
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="absolute top-0.5 right-0.5 z-10 bg-black/60 rounded-full p-0.5 text-white hover:bg-black/80"
              >
                <X size={11} />
              </button>
            )}

            {p.error && (
              <div className="absolute bottom-0 left-0 right-0 bg-red-500/80 text-white text-[9px] text-center py-0.5 truncate px-0.5">
                {p.error}
              </div>
            )}
          </div>
        ))}

        {remaining > 0 && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="w-16 h-16 rounded-lg border-2 border-dashed border-slate-300 flex flex-col items-center justify-center text-slate-400 hover:border-[#0A4A52] hover:text-[#0A4A52] transition-colors"
          >
            <Camera size={20} />
            <span className="text-[10px] mt-0.5">Add</span>
          </button>
        )}
      </div>

      <div className="text-xs text-slate-400 mt-1">{photos.length}/{maxPhotos} photos</div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFiles}
      />
    </div>
  )
}
