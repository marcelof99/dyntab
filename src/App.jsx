import React, { useState, useEffect } from 'react'
import DrillDownTable from './components/DrillDownTable'
import financialData from './data/financialData.json'
import acmeSalesData from './data/acmeSalesData.json'
import './App.css'

function App() {
  const [selectedData, setSelectedData] = useState('financial')
  const [tableConfig, setTableConfig] = useState(financialData)

  useEffect(() => {
    // Update table config when selection changes
    if (selectedData === 'financial') {
      setTableConfig(financialData)
    } else {
      setTableConfig(acmeSalesData)
    }
  }, [selectedData])

  return (
    <div className="App">
      <div className="header-container">
        <div className="data-selector">
          <label htmlFor="data-select">Select Dataset: </label>
          <select 
            id="data-select" 
            value={selectedData} 
            onChange={(e) => setSelectedData(e.target.value)}
            className="data-dropdown"
          >
            <option value="financial">Regional Performance</option>
            <option value="acme">Sales Channels</option>
          </select>
        </div>
        <h1>{tableConfig.title || 'Dynamic Drill-Down Table'}</h1>
      </div>
      <DrillDownTable config={tableConfig} />
    </div>
  )
}

export default App
