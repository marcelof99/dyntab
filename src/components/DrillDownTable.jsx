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
  const [allColumnsCollapsed, setAllColumnsCollapsed] = useState(!get(config, 'columnDimensions[0].canCollapse', false)); // Initialize based on config
  // Tracks which *individual dimension groups* are expanded (vs showing a single collapsed group column)
  const [expandedGroups, setExpandedGroups] = useState(() => {
    // Initialize with all collapsible groups expanded by default
    const initialExpanded = new Set();
    get(config, 'columnDimensions[0].columns', []).forEach(group => {
      if (group.canCollapse) { // Only add collapsible groups initially
        initialExpanded.add(group.id);
      }
    });
    return initialExpanded;
  });
  // State for focused drilldown (e.g., showing only specific group data for a time period)
  const [focusedDrilldown, setFocusedDrilldown] = useState(null);
  // State for the tooltip/menu visibility and position
  const [hoveredCell, setHoveredCell] = useState(null); // { options: [], x: number, y: number, data: object } | null
  // State to track the last selected drilldown option (optional, for potential future use)
  const [selectedDrillDown, setSelectedDrillDown] = useState(null);

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

  // Calculate the grand total across all lowest level columns (countries)
  const grandTotal = useMemo(() => {
     if (!leafColumns || leafColumns.length === 0) return 0;
     // Sum the calculated country totals
     return leafColumns.reduce((sum, country) => sum + get(columnTotals, country.id, 0), 0);
  }, [columnTotals, leafColumns]);

  // Calculate the total width of the lowest level data columns (countries)
  const totalDataColumnsWidth = useMemo(() => {
    if (!leafColumns || leafColumns.length === 0) return 200; // Default fallback
    return leafColumns.reduce((sum, country) => sum + (country.width || 90), 0); // Default width if not specified
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
        const isExpanded = expandedGroups.has(group.id);
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
  }, [allColumnsCollapsed, expandedGroups, groupColumns, mainColumnDimension]);

  // Calculate the total width of the *visible* columns
  const totalVisibleColumnsWidth = useMemo(() => {
    return visibleColumns.reduce((sum, col) => sum + (col.width || 100), 0); // Use 100 as fallback
  }, [visibleColumns]);

  // --- Event Handlers ---

  const toggleRow = (rowId) => {
    const newExpandedRows = new Set(expandedRows);
    if (expandedRows.has(rowId)) {
      newExpandedRows.delete(rowId);
      // Clear active breakdown if the parent row is collapsed
      if (focusedDrilldown && focusedDrilldown.parentRowId === rowId) {
        setFocusedDrilldown(null);
      }
    } else {
      newExpandedRows.add(rowId);
    }
    setExpandedRows(newExpandedRows);
  };

  // Toggles the top-level collapse state
  const toggleAllColumns = () => {
     if (canCollapseAllColumns) {
        setAllColumnsCollapsed(!allColumnsCollapsed);
     }
  };

  // Toggles the expansion state of an individual group
  const toggleGroupExpansion = (groupId) => {
    const newExpandedGroups = new Set(expandedGroups);
    if (expandedGroups.has(groupId)) {
      newExpandedGroups.delete(groupId);
    } else {
      newExpandedGroups.add(groupId);
    }
    setExpandedGroups(newExpandedGroups);
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

  // --- Tooltip / Menu Logic ---

  // Renders the drilldown menu
  const DrillDownTooltip = ({ options, position }) => {
    if (!position || !options || options.length === 0) return null;
    
    const handleOptionClickInternal = (option) => {
       handleOptionClick(option, position.data);
    };

    return (
      <div 
        style={{
          position: 'fixed',
          left: position.x + 10,
          top: position.y + 10,
          backgroundColor: '#2d3748',
          border: '1px solid #4a5568',
          borderRadius: '4px',
          padding: '8px 12px',
          zIndex: 1000,
          boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
          fontSize: '12px',
          color: '#e2e8f0',
          minWidth: '200px'
        }}
        className="drilldown-tooltip"
      >
        <div style={{ marginBottom: '8px', color: '#63b3ed', fontWeight: '500' }}>
          Select Drill-down Action:
        </div>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {options.map((option, index) => (
            <li 
              key={index} 
              onClick={() => handleOptionClickInternal(option)}
              style={{
                padding: '6px 8px',
                margin: '2px 0',
                color: '#a0aec0',
                cursor: 'pointer',
                borderRadius: '3px',
                transition: 'all 0.2s',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
               }}
            >
              <span style={{ width: '16px', height: '16px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px' }}>
                {option.icon}
              </span>
              {option.label}
            </li>
          ))}
        </ul>
      </div>
    );
  };

  // Determines available drilldown options based on context
   const getTooltipOptions = (contextType, contextData) => {
    const options = [];
    const currentItem = contextData?.row;
    const level = contextData?.level ?? 0; // Get level from context
    const hasChildren = currentItem?.children?.length > 0;
    const hierarchy = get(rowDimension, 'hierarchy', []); // e.g., ["Period", "SubPeriod", "Detail"]
    const parentHierarchyLevel = hierarchy[level] || `Level ${level}`;
    const childHierarchyLevel = hierarchy[level + 1] || `Level ${level + 1}`;

    switch (contextType) {
      case 'rowLevel0Collapsed': // Clicked on the combined cell (top level, columns collapsed)
        if (hasChildren) {
          options.push({ label: `Expand by ${childHierarchyLevel}`, icon: '↓', action: 'expandRow' });
        }
        if (canCollapseAllColumns) {
          options.push({ label: `Split by ${mainColumnDimension.title || 'Columns'}`, icon: '→', action: 'expandColumnGroup' });
        }
        break;
      case 'rowLevel0ExpandedCell': // Hovered on a specific cell (top level, columns expanded)
      case 'rowLevel1ExpandedCell': // Hovered on a specific cell (second level, columns expanded)
         if (hasChildren) {
             // Offer breakdown to next level, or specific column breakdown if applicable
             const breakdownLabel = level === 0 ? `${childHierarchyLevel} Breakdown` : 'Weekly Breakdown'; // Example specific label
             options.push({ label: breakdownLabel, icon: '↓', action: 'setActiveBreakdown' });
         }
         // Add other relevant options?
         options.push({ label: `Compare ${mainColumnDimension.title}`, icon: '↔', action: 'compareColumns' }); // Placeholder
         break;
      case 'rowLevel0Label': // Clicked/Hovered on the top level label
      case 'rowLevel1Label': // Clicked/Hovered on the second level label
         if (hasChildren) {
             options.push({ label: `Expand/Collapse ${childHierarchyLevel}`, icon: '↕', action: 'toggleRowOnly' });
         }
         // Option to collapse columns from row label?
         if (level === 0 && canCollapseAllColumns && allColumnsCollapsed && mainColumnDimension) {
             options.push({ label: `Collapse ${mainColumnDimension.title || 'Columns'}`, icon: '←', action: 'collapseColumnGroup' });
         }
        break;
       // No specific actions defined for Level 2 (Week) label/cells currently
        case 'totalCell': // Hovered on a total cell
         options.push({ label: `View All ${hierarchy[0]}s`, icon: '↕', action: 'viewAllRows' }); // Use first level name
         if (canCollapseAllColumns && allColumnsCollapsed) {
             options.push({ label: `Collapse ${mainColumnDimension.title}`, icon: '←', action: 'collapseColumnGroup' });
         } else if (canCollapseAllColumns && !allColumnsCollapsed) {
              options.push({ label: `Expand ${mainColumnDimension.title}`, icon: '→', action: 'expandColumnGroup' });
         }
        options.push({ label: `View All ${mainColumnDimension.title}`, icon: '↔', action: 'viewAllColumns' }); // Placeholder / Clear breakdown
        break;
      default:
        break;
    }
    return options;
  };
  
  // Sets the state to show the tooltip/menu
  const showMenu = (e, contextType, contextData) => {
     if (e && typeof e.stopPropagation === 'function') { e.stopPropagation(); }
     const options = getTooltipOptions(contextType, contextData);
     if (options.length > 0) {
        setHoveredCell({ options, x: e.clientX, y: e.clientY, data: contextData });
     } else {
         setHoveredCell(null);
     }
  };

  // Handles clicks on menu options
  const handleOptionClick = (option, contextData) => {
    setHoveredCell(null);
    setSelectedDrillDown(option);

    const rowId = contextData?.row?.id;
    const columnId = contextData?.columnId;
    const rowData = contextData?.row;
    const level = contextData?.level ?? 0;

    const columnsWereCollapsed = !allColumnsCollapsed;

    switch (option.action) {
      case 'expandRow': // Expand row AND columns if columns were collapsed
        if (rowId && rowData && rowData.children && rowData.children.length > 0) {
          if (!expandedRows.has(rowId)) { // Expand if not already expanded
            toggleRow(rowId);
          }
          // Clear specific breakdown ONLY if it matches the row being expanded
          if (focusedDrilldown && focusedDrilldown.parentRowId === rowId) { 
            setFocusedDrilldown(null);
          }
          if (columnsWereCollapsed && canCollapseAllColumns) { // Expand columns too if they were collapsed
            setAllColumnsCollapsed(true);
          }
        }
        break;
       case 'toggleRowOnly': // Just expand/collapse the row
          if (rowId) {
             toggleRow(rowId);
             // Clear breakdown if collapsing the parent of an active breakdown
             if (expandedRows.has(rowId) && focusedDrilldown && focusedDrilldown.parentRowId === rowId) {
                 setFocusedDrilldown(null);
             }
          }
          break;
      case 'expandColumnGroup': // Expand columns only
        if (!allColumnsCollapsed && canCollapseAllColumns) {
          toggleAllColumns();
        }
        break;
       case 'collapseColumnGroup': // Collapse columns only
          if (allColumnsCollapsed && canCollapseAllColumns) {
             toggleAllColumns();
          }
          break;
      case 'setActiveBreakdown': // Show child rows for a specific column (now applies to Quarter or Month)
        if (rowId && columnId && rowData && rowData.children && rowData.children.length > 0) {
          if (!expandedRows.has(rowId)) { // Ensure parent is expanded
            toggleRow(rowId);
          }
          // NOTE: This still sets breakdown based on the PARENT row (Quarter or Month)
          // Drilling down to Week level will show all columns for now.
          setFocusedDrilldown({ parentRowId: rowId, columnId: columnId });
        }
        break;
      case 'viewAllColumns': // Clear specific column breakdown, ensure columns expanded
         if (canCollapseAllColumns && !allColumnsCollapsed) {
            toggleAllColumns(); // Expand columns if needed
         }
         setFocusedDrilldown(null); // Clear breakdown filter
         console.log('View all columns / Clear breakdown');
         break;
       case 'compareColumns': // Placeholder
         console.log('Compare columns action triggered for:', contextData);
         break;
       case 'viewAllRows': // Placeholder - e.g., collapse all rows
          setExpandedRows(new Set());
          setFocusedDrilldown(null); // Clear breakdown filter
          console.log('View all rows action triggered (collapsing all)');
         break;
      default:
        console.log('Unknown drill-down action:', option.action, 'with data:', contextData);
    }
  };


  // --- Rendering Logic ---

  const renderRow = (item, level = 0) => {

    const isExpanded = expandedRows.has(item.id);
    const hasChildren = item.children && item.children.length > 0;
    const hierarchy = get(rowDimension, 'hierarchy', []); 
    
    // Determine if this row is a child under an active breakdown filter (logic might need update)
    const parentLevel = level > 0 ? level - 1 : 0;
    const parentId = level > 0 ? item.id.substring(0, item.id.lastIndexOf('-')) : null; 
    const isUnderActiveBreakdown = focusedDrilldown && parentId === focusedDrilldown.parentRowId;
    // activeColumnId now refers to the lowest level (country), breakdown logic might need rethinking
    const activeColumnId = isUnderActiveBreakdown ? focusedDrilldown.columnId : null; 

    // Calculate percentage using the aggregated value for the row
    let percentageOfGrandTotal = null;
    if (grandTotal > 0) {
        const rowTotal = calculate(item); // Get total aggregated value for the row
        percentageOfGrandTotal = (rowTotal / grandTotal) * 100;
    }

    const rowLabel = item.label || item.id;

    // Define styles based on level
    const getLevelColor = () => {
       if (level === 0) return hasChildren ? '#63b3ed' : '#e2e8f0';
       if (level === 1) return hasChildren ? '#a0aec0' : '#cbd5e0'; // Slightly dimmer for month
       return '#718096'; // Dimmer for week
    };
     const getLevelFontWeight = () => {
        if (level === 0) return '600';
        if (level === 1) return '500';
        return '400';
     };

    return (
      <React.Fragment key={item.id}>
        <tr 
         className={`row-level-${level} ${hasChildren ? 'has-children' : ''}`}
         style={{ 
            backgroundColor: level === 0 ? '#1a1a1a' : (level === 1 ? '#111111' : '#0a0a0a'),
            cursor: 'default',
         }}
        >
          {/* Row Label/Hierarchy Column */}
          <td style={{ 
            paddingLeft: `${level * 20 + 8}px`,
            color: getLevelColor(),
            display: 'flex',
            alignItems: 'center',
            minWidth: `${rowDimension.width || 200}px`, 
            width: `${rowDimension.width || 200}px`, 
            fontWeight: getLevelFontWeight(),
            cursor: hasChildren ? 'pointer' : 'default',
            fontSize: level > 1 ? '14px' : '15px',
          }}
          >
            {/* Expansion Indicator */}
             {hasChildren && (
               <span style={{ marginRight: '8px', color: '#9ca3af', display: 'inline-flex', width: '20px', cursor: 'pointer' }} 
                     onClick={(e) => { e.stopPropagation(); toggleRow(item.id); }}>
                 {isExpanded ? '▼' : '▶'}
               </span>
             )}
             {!hasChildren && <span style={{ width: '20px', display: 'inline-block', marginRight: '8px' }}>{level > 0 ? '•' : ''}</span>}
            {rowLabel}
          </td>
          
          {/* Data Columns (Iterate through visibleColumns) */}
          {visibleColumns.map(col => {
            let cellValue = null;
            let cellStyle = { 
                textAlign: 'right', 
                fontWeight: getLevelFontWeight(), 
                fontSize: level > 1 ? '14px' : '15px', 
                minWidth: `${col.width}px`, 
                width: `${col.width}px`, 
                cursor: 'default' // Default, override below
            };
            let eventHandlers = {};

            if (col.isCombined) {
                // Use aggregated value for the combined column
                cellValue = calculate(item);
                cellStyle.color = level > 0 ? (level === 1 ? '#cbd5e0' : '#a0aec0') : '#e2e8f0';
                if (level < hierarchy.length - 1 && hasChildren) {
                   cellStyle.cursor = 'pointer';
                   eventHandlers.onClick = (e) => showMenu(e, `rowLevel${level}Collapsed`, { row: item, level: level });
                }
            } else if (col.isCollapsedGroup) {
                 // Use aggregated value for the specific collapsed group
                 cellValue = calculate(item, col.groupId);
                 cellStyle.color = level > 0 ? (level === 1 ? '#cbd5e0' : '#a0aec0') : '#e2e8f0';
                 cellStyle.backgroundColor = 'rgba(0,0,0,0.1)';

            } else if (col.isLeaf) {
                // Use aggregated value for the specific leaf
                cellValue = calculate(item, col.groupId, col.id);
                // Dim text if under specific column breakdown, or generally for deeper levels
                cellStyle.color = (activeColumnId && activeColumnId !== col.id) ? '#555' : (level > 0 ? (level === 1 ? '#cbd5e0' : '#a0aec0') : '#e2e8f0'); 
                if (level < hierarchy.length - 1 && hasChildren) {
                   cellStyle.cursor = 'help';
                }
            }

            return (
              <td key={col.id} style={cellStyle} {...eventHandlers}>
                 {/* Format the calculated aggregated value */}
                {formatValue(cellValue, metric)}
              </td>
            );
          })}

          {/* Total Metric Column (Uses updated percentageOfGrandTotal) */}
          {totalMetric && (
             <td 
               style={{ 
                 textAlign: 'right',
                 color: isUnderActiveBreakdown ? '#555' : (level === 0 ? '#63b3ed' : (level === 1 ? '#a0aec0' : '#718096')),
                 minWidth: `${totalMetric.width || 120}px`, 
                 width: `${totalMetric.width || 120}px`, 
                 fontWeight: getLevelFontWeight(),
                 fontSize: level > 1 ? '14px' : '15px',
                 cursor: 'default'
               }}
             >
               {percentageOfGrandTotal !== null ? formatValue(percentageOfGrandTotal, totalMetric) : ''}
             </td>
           )}
        </tr>
        
        {/* Render Children Recursively */}
        {isExpanded && hasChildren && item.children.map(child => renderRow(child, level + 1))}
      </React.Fragment>
    );
  };

  // --- Main Render ---

  return (
    <div className="table-container">
      <table className="drill-down-table">
        <thead>
          {/* Header Row 1: Top Group (Regions) */}
          <tr>
             <th rowSpan={allColumnsCollapsed ? 1 : 3} style={{ textAlign: 'left', minWidth: `${rowDimension.width || 200}px`, width: `${rowDimension.width || 200}px` }}>
                {rowDimension.title}
             </th>
            {mainColumnDimension && (
               <th 
                 colSpan={visibleColumns.length} // Span across all *visible* columns
                 style={{ 
                   textAlign: 'center',
                   minWidth: `${totalVisibleColumnsWidth}px`, // Use dynamic total width
                   width: `${totalVisibleColumnsWidth}px`, 
                   cursor: canCollapseAllColumns ? 'pointer' : 'default',
                   backgroundColor: '#1a1a1a', color: '#63b3ed',
                   position: 'relative', paddingLeft: canCollapseAllColumns ? '28px' : '0px' 
                 }}
                 onClick={toggleAllColumns} // Use the new handler
               >
                 {canCollapseAllColumns && (
                    <span style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', }}>
                      {allColumnsCollapsed ? '▶' : '▼'} {/* Icon reflects top-level collapse state */}
                    </span>
                  )}
                 {mainColumnDimension.title}
               </th>
            )}
             {totalMetric && (
                <th rowSpan={allColumnsCollapsed ? 1 : 3} style={{ textAlign: 'right', minWidth: `${totalMetric.width || 120}px`, width: `${totalMetric.width || 120}px` }}>
                   {totalMetric.title}
                </th>
             )}
          </tr>

          {/* Header Row 2: Intermediate Group (Region Names) */}
          {!allColumnsCollapsed && mainColumnDimension && (
            <tr>
              {groupColumns.map(group => {
                 const isExpanded = expandedGroups.has(group.id);
                 const groupLeaves = group.columns || [];
                 const colSpan = isExpanded ? groupLeaves.length : 1;
                 const width = isExpanded 
                     ? groupLeaves.reduce((sum, leaf) => sum + (leaf.width || 90), 0) 
                     : (group.collapsedWidth || 100);
                 
                 return (
                    <th 
                       key={group.id}
                       colSpan={colSpan}
                       style={{
                           textAlign: 'center', 
                           minWidth: `${width}px`, 
                           width: `${width}px`,
                           cursor: group.canCollapse ? 'pointer' : 'default',
                           backgroundColor: '#1a1a1a',
                           borderLeft: '1px solid #333', 
                           borderBottom: '1px solid #333',
                           position: 'relative',
                           paddingLeft: group.canCollapse ? '24px' : '4px' // Space for icon
                       }}
                       onClick={() => group.canCollapse && toggleGroupExpansion(group.id)} // Toggle this group
                    >
                       {group.canCollapse && (
                          <span style={{ position: 'absolute', left: '4px', top: '50%', transform: 'translateY(-50%)', fontSize: '10px', color: '#9ca3af' }}>
                             {isExpanded ? '▼' : '▶'}
                          </span>
                       )}
                       {group.title}
                    </th>
                 );
              })}
            </tr>
          )}
          {/* Header Row 3: Lowest Level (Visible Countries / Collapsed Regions) */}
          {!allColumnsCollapsed && mainColumnDimension && (
            <tr>
              {visibleColumns.map(col => (
                 <th 
                    key={col.id} 
                    style={{ 
                       textAlign: 'right', 
                       minWidth: `${col.width}px`, 
                       width: `${col.width}px`,
                       backgroundColor: '#1a1a1a', 
                       borderLeft: '1px solid #333' 
                    }}
                 >
                    {/* Only show title for actual leaves, collapsed group title is in row above */}
                    {col.isLeaf ? col.title : ''} 
                 </th>
              ))}
            </tr>
          )}
        </thead>

        <tbody>
          {/* Data Rows */}
          {topLevelRowData.map(item => renderRow(item, 0))} 
          
          {/* Total Row */}
          <tr className="total-row">
             {/* Total Label */}
            <td style={{ fontWeight: 'bold', color: '#63b3ed', minWidth: `${rowDimension.width || 200}px`, width: `${rowDimension.width || 200}px` }}>Total</td>
            
            {/* Column Totals (Iterate through visibleColumns) */}
            {visibleColumns.map(col => {
               let totalValue = null;
               let eventHandlers = {};

               if (col.isCombined) {
                  totalValue = grandTotal;
               } else if (col.isCollapsedGroup) {
                   // Sum totals for the collapsed group
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
                    style={{ 
                       textAlign: 'right', fontWeight: 'bold', color: '#63b3ed', 
                       minWidth: `${col.width}px`, width: `${col.width}px`, 
                       cursor: 'help' 
                    }}
                    {...eventHandlers}
                  >
                     {formatValue(totalValue, metric)}
                  </td>
               );
            })}
            
            {/* Total Metric Grand Total (Unchanged) */}
             {totalMetric && (
                 <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#63b3ed', minWidth: `${totalMetric.width || 120}px`, width: `${totalMetric.width || 120}px` }}>
                   {formatValue(100, totalMetric)} 
                 </td>
             )}
          </tr>
        </tbody>
      </table>

      {/* Render the Tooltip/Menu */}
      {hoveredCell && <DrillDownTooltip options={hoveredCell.options} position={hoveredCell} />}
    </div>
  );
};

export default DrillDownTable; 