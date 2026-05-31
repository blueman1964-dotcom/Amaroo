import { useEffect, useCallback, useState } from 'react'
import { X, ChevronLeft, ChevronRight, Download } from 'lucide-react'

export function PhotoImg({ src, alt = '', className = '', style }) {
  const [status, setStatus] = useState('loading') // loading | ok | error

  return (
    <div className={`relative overflow-hidden bg-slate-200 ${className}`} style={style}>
      {status === 'loading' && (
        <div className="absolute inset-0 animate-pulse bg-slate-200" />
      )}
      {status === 'error' ? (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-100 text-slate-400 text-xs">
          No image
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          className={`w-full h-full object-cover transition-opacity duration-200 ${status === 'loading' ? 'opacity-0' : 'opacity-100'}`}
          onLoad={() => setStatus('ok')}
          onError={() => setStatus('error')}
        />
      )}
    </div>
  )
}

export default function PhotoGallery({ photos, initialIndex = 0, onClose }) {
  const [index, setIndex] = useState(initialIndex)
  const [fade, setFade] = useState(true)
  const [touchStart, setTouchStart] = useState(null)

  const go = useCallback((next) => {
    setFade(false)
    setTimeout(() => {
      setIndex(next)
      setFade(true)
    }, 120)
  }, [])

  const prev = useCallback(() => {
    if (photos.length > 1) go((index - 1 + photos.length) % photos.length)
  }, [go, index, photos.length])

  const next = useCallback(() => {
    if (photos.length > 1) go((index + 1) % photos.length)
  }, [go, index, photos.length])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') prev()
      if (e.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose, prev, next])

  const handleTouchStart = (e) => setTouchStart(e.touches[0].clientX)
  const handleTouchEnd = (e) => {
    if (touchStart === null) return
    const dx = e.changedTouches[0].clientX - touchStart
    if (dx < -40) next()
    else if (dx > 40) prev()
    setTouchStart(null)
  }

  const handleDownload = () => {
    const url = typeof photos[index] === 'string' ? photos[index] : photos[index]?.url
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = `photo-${index + 1}.jpg`
    a.target = '_blank'
    a.click()
  }

  const photoUrl = typeof photos[index] === 'string' ? photos[index] : photos[index]?.url

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.92)' }}
      onClick={onClose}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 z-10" onClick={(e) => e.stopPropagation()}>
        <span className="text-white/70 text-sm">{index + 1} / {photos.length}</span>
        <div className="flex items-center gap-3">
          <button onClick={handleDownload} className="text-white/70 hover:text-white p-1">
            <Download size={20} />
          </button>
          <button onClick={onClose} className="text-white/70 hover:text-white p-1">
            <X size={22} />
          </button>
        </div>
      </div>

      {/* Prev arrow */}
      {photos.length > 1 && (
        <button
          className="absolute left-2 top-1/2 -translate-y-1/2 z-10 text-white/70 hover:text-white p-2 bg-black/30 rounded-full"
          onClick={(e) => { e.stopPropagation(); prev() }}
        >
          <ChevronLeft size={28} />
        </button>
      )}

      {/* Image */}
      <div
        className="max-w-full max-h-full flex items-center justify-center px-14"
        style={{ transition: 'opacity 0.12s', opacity: fade ? 1 : 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={photoUrl}
          alt=""
          className="max-w-[90vw] max-h-[85vh] object-contain rounded"
          draggable={false}
        />
      </div>

      {/* Next arrow */}
      {photos.length > 1 && (
        <button
          className="absolute right-2 top-1/2 -translate-y-1/2 z-10 text-white/70 hover:text-white p-2 bg-black/30 rounded-full"
          onClick={(e) => { e.stopPropagation(); next() }}
        >
          <ChevronRight size={28} />
        </button>
      )}
    </div>
  )
}
