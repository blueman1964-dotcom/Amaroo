import { useState, useEffect, useRef } from 'react'
import { getActiveVoyageConfig, getStores, getHistoricalRatings } from './GalleyUtils'
import VoyageSetup from './VoyageSetup'
import StoresManager from './StoresManager'
import MealPlanner from './MealPlanner'
import ShoppingList from './ShoppingList'
import GalleyReview from './GalleyReview'

const SUB_TABS = [
  { id: 'setup', label: 'Setup' },
  { id: 'stores', label: 'Stores' },
  { id: 'meal-plan', label: 'Meal Plan' },
  { id: 'shopping', label: 'Shopping List' },
  { id: 'review', label: 'Review' },
]

export default function GalleyTab() {
  const [activeSubTab, setActiveSubTab] = useState('setup')
  const [voyageConfig, setVoyageConfig] = useState(null)
  const [stores, setStores] = useState([])
  const [historicalRatings, setHistoricalRatings] = useState([])
  const [loadingConfig, setLoadingConfig] = useState(true)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)

  function showToast(message, type = 'success') {
    clearTimeout(toastTimer.current)
    setToast({ message, type })
    toastTimer.current = setTimeout(() => setToast(null), type === 'error' ? 10000 : 4000)
  }

  async function loadConfig() {
    try {
      const config = await getActiveVoyageConfig()
      setVoyageConfig(config)
    } catch (err) {
      showToast(err.message || 'Failed to load voyage config.', 'error')
    } finally {
      setLoadingConfig(false)
    }
  }

  async function loadStores() {
    try {
      const data = await getStores()
      setStores(data || [])
    } catch (err) {
      showToast(err.message || 'Failed to load stores.', 'error')
    }
  }

  useEffect(() => {
    loadConfig()
    loadStores()
    getHistoricalRatings().then(setHistoricalRatings).catch(() => {})
  }, [])

  function handleVoyageSaved() {
    loadConfig()
  }

  function handleStoresUpdated() {
    loadStores()
  }

  return (
    <div className="relative">
      {/* Header */}
      <div className="mb-4">
        <h2 className="font-serif text-2xl text-[#0A4A52]">Galley</h2>
        <p className="text-sm text-slate-500">Meal planning & stores management</p>
      </div>

      {/* Sub-tab navigation */}
      <div className="flex gap-1 mb-6 border-b border-slate-200">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveSubTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition -mb-px ${
              activeSubTab === tab.id
                ? 'border-[#0A4A52] text-[#0A4A52] bg-white'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            {tab.label}
            {tab.id === 'stores' && stores.length > 0 && (
              <span className="ml-1.5 text-xs bg-teal-100 text-[#0A4A52] rounded-full px-1.5 py-0.5">
                {stores.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Voyage config banner */}
      {!loadingConfig && !voyageConfig && activeSubTab !== 'setup' && (
        <div className="mb-4 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          No voyage configured.{' '}
          <button
            type="button"
            onClick={() => setActiveSubTab('setup')}
            className="underline font-medium"
          >
            Set up a voyage first.
          </button>
        </div>
      )}

      {/* Sub-tab content */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_8px_24px_rgba(10,74,82,0.08)]">
        {activeSubTab === 'setup' && (
          <VoyageSetup
            voyageConfig={voyageConfig}
            onSaved={handleVoyageSaved}
          />
        )}

        {activeSubTab === 'stores' && (
          <StoresManager
            stores={stores}
            onStoresUpdated={handleStoresUpdated}
            showToast={showToast}
            voyageConfig={voyageConfig}
          />
        )}

        {activeSubTab === 'meal-plan' && (
          <MealPlanner
            voyageConfig={voyageConfig}
            stores={stores}
            showToast={showToast}
            onStoresUpdated={handleStoresUpdated}
            historicalRatings={historicalRatings}
            onRatingsUpdated={() => getHistoricalRatings().then(setHistoricalRatings).catch(() => {})}
          />
        )}

        {activeSubTab === 'review' && (
          <GalleyReview voyageConfig={voyageConfig} />
        )}

        {activeSubTab === 'shopping' && (
          <ShoppingList
            voyageConfig={voyageConfig}
            stores={stores}
            showToast={showToast}
            onStoresUpdated={handleStoresUpdated}
          />
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-xl text-white text-sm shadow-lg transition-all ${
            toast.type === 'error' ? 'bg-red-600' : 'bg-[#0A4A52]'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  )
}
