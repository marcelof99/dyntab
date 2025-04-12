import React, { useState, useMemo, useRef } from 'react';

// Helper function to get nested property safely (Simplified)
const get = (obj, path, defaultValue = undefined) => {
  const keys = path.split('.');
  let result = obj;
  for (const key of keys) {
    result = result?.[key]; // Use optional chaining
    if (result === undefined || result === null) { // Check for null as well
      // If we encounter undefined/null midway, return default
      return defaultValue;
    }
  }
  // Handle case where the final result might be explicitly null but valid
  return result === undefined ? defaultValue : result;
};

const DrillDownTable = ({ config }) => {
  console.log("DrillDownTable received config:", config); // Log received config

  if (!config) {
    return <div>Loading configuration...</div>;
  }

  // State for expanded rows (using Set for efficient add/delete/has)
  const [expandedRows, setExpandedRows] = useState(new Set());
  // Tracks if the *entire* column group is collapsed into one column
  const [allColumnsCollapsed, setAllColumnsCollapsed] = useState(false);
  // Tracks which *individual column dimension groups* are expanded
  const [expandedColGroups, setExpandedColGroups] = useState(new Set());
  // State for focused drilldown (e.g., showing only specific group data for a time period)
  const [focusedDrilldown, setFocusedDrilldown] = useState(null);
  // State for collapsing all rows
  const [allRowsCollapsed, setAllRowsCollapsed] = useState(false);

  // Constants derived from config
  const rowDimension = config.rowDimension;
  const mainColumnDimension = config.columnDimensions && config.columnDimensions[0]; // e.g., Regions config
  const groupColumns = mainColumnDimension ? mainColumnDimension.columns : [];
  // Flatten the lowest level columns (countries) for iteration and width calculation
  const leafColumns = useMemo(() => {
    return groupColumns.flatMap(group => 
      group.columns ? group.columns.map(leaf => ({ ...leaf, groupId: group.id })) : []
    );
  }, [groupColumns]);
  const metric = config.metric;
  const totalMetric = config.totalMetric;
  const topLevelRowData = config.rowData || [];
  const canCollapseAllColumns = mainColumnDimension && mainColumnDimension.canCollapse;
  const canCollapseAllRows = true; // Assuming rows can always be collapsed for now

  // console.log("Derived regionColumns:", regionColumns);
  // console.log("Derived countryColumns:", countryColumns);
  // console.log("Derived topLevelRowData:", topLevelRowData);

  // --- Memoized Calculations ---

  // Calculate totals for the lowest level columns (countries)
  const columnTotals = useMemo(() => {
    if (!leafColumns || leafColumns.length === 0) return {};
    const totals = leafColumns.reduce((acc, country) => {
      acc[country.id] = 0;
      return acc;
    }, {});

    topLevelRowData.forEach(item => {
      groupColumns.forEach(group => {
         if (group.columns) {
            group.columns.forEach(country => {
                const path = `values.${group.id}.${country.id}`;
                const value = get(item, path, 0);
                console.log(`columnTotals: item=${item.id}, path=${path}, value=${value}`); // Log path and value
                totals[country.id] += value;
            });
         }
      });
    });
    return totals;
  }, [topLevelRowData, groupColumns, leafColumns]);

  // Calculate the grand total across all lowest level columns (leaves)
  const grandTotal = useMemo(() => {
     if (!leafColumns || leafColumns.length === 0) return 0;
     // Sum the calculated leaf totals
     return leafColumns.reduce((sum, leaf) => sum + get(columnTotals, leaf.id, 0), 0);
  }, [columnTotals, leafColumns]);

  // Calculate the total width of the lowest level data columns (leaves)
  const totalDataColumnsWidth = useMemo(() => {
    if (!leafColumns || leafColumns.length === 0) return 200; // Default fallback
    return leafColumns.reduce((sum, leaf) => sum + (leaf.width || 90), 0); // Default width if not specified
  }, [leafColumns]);

  // Get the width for the collapsed state
  const collapsedColumnWidth = useMemo(() => {
      return get(mainColumnDimension, 'collapsedWidth', 200); // Default fallback width when collapsed
  }, [mainColumnDimension]);

  // Calculate totals for a given item
  const calculate = useMemo(() => {
    const calculationCache = new Map();
    
    return (item, targetGroupId = null, targetLeafId = null) => {
      const memoKey = `${item.id}-${targetGroupId}-${targetLeafId}`;
      if (calculationCache.has(memoKey)) {
        return calculationCache.get(memoKey);
      }

      let totalValue = 0;
      
      // Sum up child values recursively
      if (item.children) {
        item.children.forEach(child => {
          totalValue += calculate(child, targetGroupId, targetLeafId);
        });
      }

      // Add this item's value if it exists
      if (targetGroupId && targetLeafId) {
        // Specific leaf value needed
        totalValue = get(item, `values.${targetGroupId}.${targetLeafId}`, 0);
      } else if (targetGroupId) {
        // Specific group total needed (sum its leaves)
        const group = groupColumns.find(g => g.id === targetGroupId);
        if (group && group.columns) {
          group.columns.forEach(leaf => {
            totalValue += get(item, `values.${targetGroupId}.${leaf.id}`, 0);
          });
        }
      } else {
        // Grand total needed (sum all groups/leaves)
        groupColumns.forEach(group => {
          if (group.columns) {
            group.columns.forEach(leaf => {
              totalValue += get(item, `values.${group.id}.${leaf.id}`, 0);
            });
          }
        });
      }

      calculationCache.set(memoKey, totalValue);
      return totalValue;
    };
  }, [groupColumns]); // Dependency: groupColumns for summing within group/all

  // --- Compute Visible Columns based on state --- 
  const visibleColumns = useMemo(() => {
    if (allColumnsCollapsed) {
        // If everything is collapsed, show one combined column
        return [{ 
            id: 'combined', 
            title: mainColumnDimension?.title || 'Combined', 
            width: get(mainColumnDimension, 'collapsedWidth', 200), 
            isCombined: true 
        }];
    }

    // Otherwise, build list based on expanded groups
    const columns = [];
    groupColumns.forEach(group => {
        const isExpanded = expandedColGroups.has(group.id);
        if (isExpanded && group.columns) {
            // Add all leaf columns for this expanded group
            group.columns.forEach(leaf => {
                columns.push({ 
                    ...leaf, 
                    groupId: group.id, 
                    isLeaf: true 
                });
            });
        } else if (group.canCollapse) {
            // Add a single placeholder for the collapsed group
             columns.push({ 
                 id: group.id, 
                 title: group.title, 
                 width: group.collapsedWidth || 100, 
                 isCollapsedGroup: true,
                 groupId: group.id // Keep groupId for consistency
             });
        } else if (group.columns) {
            // Group cannot collapse, always show leaves
             group.columns.forEach(leaf => {
                columns.push({ ...leaf, groupId: group.id, isLeaf: true });
            });
        }
        // Handle groups without leaves? (Edge case - add placeholder?)
        // else { columns.push({ id: group.id, title: group.title, width: 100, isPlaceholder: true }); }
    });
    return columns;
  }, [allColumnsCollapsed, expandedColGroups, groupColumns, mainColumnDimension]);

  // Calculate the total width of the *visible* columns
  const totalVisibleColumnsWidth = useMemo(() => {
    return visibleColumns.reduce((sum, col) => sum + (col.width || 100), 0); // Use 100 as fallback
  }, [visibleColumns]);

  // --- Event Handlers ---

  const toggleRow = (rowId) => {
    const newExpandedRows = new Set(expandedRows);
    if (expandedRows.has(rowId)) {
      newExpandedRows.delete(rowId);
      if (focusedDrilldown && focusedDrilldown.parentRowId === rowId) {
        setFocusedDrilldown(null);
      }
    } else {
      newExpandedRows.add(rowId);
    }
    setExpandedRows(newExpandedRows);
  };

  const toggleAllColumns = () => {
    if (canCollapseAllColumns) {
      setAllColumnsCollapsed(!allColumnsCollapsed);
    }
  };

  const toggleColGroup = (groupId) => {
    const newExpandedColGroups = new Set(expandedColGroups);
    if (expandedColGroups.has(groupId)) {
      newExpandedColGroups.delete(groupId);
    } else {
      newExpandedColGroups.add(groupId);
    }
    setExpandedColGroups(newExpandedColGroups);
  };

  // Toggle the collapse state for all rows
  const toggleAllRows = () => {
    if (canCollapseAllRows) { // Add check if needed later
      setAllRowsCollapsed(!allRowsCollapsed);
      // Optionally collapse individual rows when collapsing all
      if (!allRowsCollapsed) {
        setExpandedRows(new Set());
      }
    }
  };

  // Formats a numerical value based on metric config
  const formatValue = (value, valueConfig = metric) => {
     if (value === null || value === undefined) return '';
     const numericValue = typeof value === 'number' ? value : parseFloat(value);
     if (isNaN(numericValue)) return ''; // Handle non-numeric input gracefully

     try {
        if (valueConfig.format === 'currency') {
            return new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: valueConfig.currencySymbol || 'USD',
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
            }).format(numericValue * 1000); // Assuming input is in thousands
        } else if (valueConfig.format === 'percentage') {
             return new Intl.NumberFormat('en-US', {
                style: 'percent',
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
            }).format(numericValue / 100); // Assuming input is 0-100
        } else {
            // Default number formatting (or add more types)
             return new Intl.NumberFormat('en-US', {
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
             }).format(numericValue);
        }
     } catch (error) {
        console.error("Formatting error:", error);
        return String(value); // Fallback to string
     }
  };

  // --- Rendering Logic ---

  const renderRow = (item, level = 0) => {
    const isExpanded = expandedRows.has(item.id);
    const hasChildren = item.children && item.children.length > 0;
    const hierarchy = get(rowDimension, 'hierarchy', []); 
    
    const parentId = level > 0 ? item.id.substring(0, item.id.lastIndexOf('-')) : null; 
    const isUnderActiveBreakdown = focusedDrilldown && parentId === focusedDrilldown.parentRowId;
    const activeColumnId = isUnderActiveBreakdown ? focusedDrilldown.columnId : null; 

    let percentageOfGrandTotal = null;
    if (grandTotal > 0) {
      const rowTotal = calculate(item);
      percentageOfGrandTotal = (rowTotal / grandTotal) * 100;
    }

    const rowLabel = item.label || item.id;

    return (
      <React.Fragment key={item.id}>
        <tr 
          className={`row-level-${level} ${hasChildren ? 'has-children' : ''}`}
        >
          <td 
            className={`row-label-cell ${level === 0 ? 'row-label-level-0' : ''}`} 
            style={{ 
              paddingLeft: `${level * 20 + 8}px`,
              minWidth: `${rowDimension.width || 200}px`, 
              width: `${rowDimension.width || 200}px`, 
            }}
          >
            {hasChildren && (
              <span 
                className="expand-indicator expand-indicator-row"
                onClick={(e) => { e.stopPropagation(); toggleRow(item.id); }}
              >
                {isExpanded ? '▼' : '▶'}
              </span>
            )}
            {!hasChildren && <span style={{ width: '16px', display: 'inline-block', marginRight: '4px' }}>{level > 0 ? '•' : ''}</span>}
            {rowLabel}
          </td>
          
          {visibleColumns.map(col => {
            let cellValue = null;
            let cellStyle = { 
              minWidth: `${col.width}px`, 
              width: `${col.width}px`
            };

            if (col.isCombined) {
              cellValue = calculate(item);
            } else if (col.isCollapsedGroup) {
              cellValue = calculate(item, col.groupId);
            } else if (col.isLeaf) {
              cellValue = calculate(item, col.groupId, col.id);
            }

            return (
              <td key={col.id} style={cellStyle}>
                {formatValue(cellValue, metric)}
              </td>
            );
          })}

          {totalMetric && (
            <td 
              style={{ 
                minWidth: `${totalMetric.width || 120}px`, 
                width: `${totalMetric.width || 120}px`, 
              }}
            >
              {percentageOfGrandTotal !== null ? formatValue(percentageOfGrandTotal, totalMetric) : ''}
            </td>
          )}
        </tr>
        
        {isExpanded && hasChildren && item.children.map(child => renderRow(child, level + 1))}
      </React.Fragment>
    );
  };

  // --- Main Render ---

  return (
    <div className="table-container">
      <table className="drill-down-table">
        <thead>
          <tr>
            <th 
              rowSpan={allColumnsCollapsed ? 1 : 3} 
              className="text-align-left expand-indicator-container"
              style={{ minWidth: `${rowDimension.width || 200}px`, width: `${rowDimension.width || 200}px`, paddingLeft: '28px' }}
              onClick={toggleAllRows}
            >
              <span className="expand-indicator expand-indicator-header-main">
                {allRowsCollapsed ? '▶' : '▼'}
              </span>
              {rowDimension.title}
            </th>
            {mainColumnDimension && (
              <th 
                colSpan={visibleColumns.length}
                className="text-align-center expand-indicator-container"
                style={{ 
                  minWidth: `${totalVisibleColumnsWidth}px`,
                  width: `${totalVisibleColumnsWidth}px`, 
                  paddingLeft: canCollapseAllColumns ? '28px' : '4px'
                }}
                onClick={toggleAllColumns}
              >
                {canCollapseAllColumns && (
                  <span className="expand-indicator expand-indicator-header-main">
                    {allColumnsCollapsed ? '▶' : '▼'}
                  </span>
                )}
                {mainColumnDimension.title}
              </th>
            )}
            {totalMetric && (
              <th 
                rowSpan={allColumnsCollapsed ? 1 : 3} 
                className="text-align-right"
                style={{ minWidth: `${totalMetric.width || 120}px`, width: `${totalMetric.width || 120}px` }}
              >
                {totalMetric.title}
              </th>
            )}
          </tr>

          {!allColumnsCollapsed && mainColumnDimension && (
            <tr>
              {groupColumns.map(group => {
                const isExpanded = expandedColGroups.has(group.id);
                const groupLeaves = group.columns || [];
                const colSpan = isExpanded ? groupLeaves.length : 1;
                const width = isExpanded 
                  ? groupLeaves.reduce((sum, leaf) => sum + (leaf.width || 90), 0) 
                  : (group.collapsedWidth || 100);
                
                return (
                  <th 
                    key={group.id}
                    colSpan={colSpan}
                    className="text-align-center expand-indicator-container"
                    style={{
                      minWidth: `${width}px`, 
                      width: `${width}px`,
                      paddingLeft: group.canCollapse ? '24px' : '4px'
                    }}
                    onClick={() => group.canCollapse && toggleColGroup(group.id)}
                  >
                    {group.canCollapse && (
                      <span className="expand-indicator expand-indicator-header-group">
                        {isExpanded ? '▼' : '▶'}
                      </span>
                    )}
                    {group.title}
                  </th>
                );
              })}
            </tr>
          )}

          {!allColumnsCollapsed && mainColumnDimension && (
            <tr>
              {visibleColumns.map(col => (
                <th 
                  key={col.id} 
                  className="text-align-right"
                  style={{ 
                    minWidth: `${col.width}px`, 
                    width: `${col.width}px`,
                  }}
                >
                  {col.isLeaf ? col.title : ''} 
                </th>
              ))}
            </tr>
          )}
        </thead>

        <tbody>
          {!allRowsCollapsed && topLevelRowData.map(item => renderRow(item, 0))} 
          
          <tr className="total-row font-weight-bold">
            <td 
              className="text-align-left total-row-label"
              style={{ minWidth: `${rowDimension.width || 200}px`, width: `${rowDimension.width || 200}px` }}
            >
              Total
            </td>
            
            {visibleColumns.map(col => {
              let totalValue = null;

              if (col.isCombined) {
                totalValue = grandTotal;
              } else if (col.isCollapsedGroup) {
                let groupTotal = 0;
                const currentGroup = groupColumns.find(g => g.id === col.groupId);
                if (currentGroup && currentGroup.columns) {
                  currentGroup.columns.forEach(leaf => {
                    groupTotal += get(columnTotals, leaf.id, 0);
                  });
                }
                totalValue = groupTotal;
              } else if (col.isLeaf) {
                totalValue = get(columnTotals, col.id);
              }

              return (
                <td 
                  key={col.id}
                  className="text-align-right total-row-cell"
                  style={{ 
                    minWidth: `${col.width}px`, 
                    width: `${col.width}px`
                  }}
                >
                  {formatValue(totalValue, metric)}
                </td>
              );
            })}
            
            {totalMetric && (
              <td 
                className="text-align-right total-row-cell"
                style={{ minWidth: `${totalMetric.width || 120}px`, width: `${totalMetric.width || 120}px` }}
              >
                {formatValue(100, totalMetric)} 
              </td>
            )}
          </tr>
        </tbody>
      </table>
    </div>
  );
};

export default DrillDownTable; 