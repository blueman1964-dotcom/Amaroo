import { createContext, useContext, useMemo, useState } from 'react'

const DataRefreshContext = createContext(null)

export function DataRefreshProvider({ children }) {
  const [refreshKeys, setRefreshKeys] = useState({
    engineHours: 0,
    maintenanceTasks: 0,
    fuelLog: 0,
    vesselSettings: 0,
    all: 0,
  })

  const value = useMemo(
    () => ({
      refreshKeys,
      triggerRefresh: (key) => {
        setRefreshKeys((prev) => ({
          ...prev,
          [key]: (prev[key] || 0) + 1,
          all: prev.all + 1,
        }))
      },
    }),
    [refreshKeys],
  )

  return <DataRefreshContext.Provider value={value}>{children}</DataRefreshContext.Provider>
}

export function useDataRefresh() {
  const ctx = useContext(DataRefreshContext)
  if (!ctx) {
    throw new Error('useDataRefresh must be used within DataRefreshProvider')
  }
  return ctx
}
