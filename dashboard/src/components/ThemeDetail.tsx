import { Link, useParams } from 'react-router-dom'
import { Download, Copy, ChevronRight } from 'lucide-react'
import { useMemo } from 'react'
import useStore from '../store/useStore'
import CommentCard from './CommentCard'
import { exportToCSV } from '../utils/helpers'
import Breadcrumbs from './Breadcrumbs'
import ThemeSummaryView from './ThemeSummaryView'

function ThemeDetail() {
  const { themeCode } = useParams<{ themeCode: string }>()
  const { themes, themeSummaries, getCommentsForTheme } = useStore()
  
  const theme = themes.find(t => t.code === themeCode)
  const themeSummary = themeCode ? themeSummaries[themeCode] : undefined
  const { direct } = themeCode ? getCommentsForTheme(themeCode) : { direct: [] }
  
  const displayedComments = direct
  
  // Build theme hierarchy
  const themeHierarchy = useMemo(() => {
    if (!theme) return []
    
    const hierarchy: typeof themes = []
    let current = theme
    
    // Walk up the parent chain
    while (current) {
      hierarchy.unshift(current)
      if (current.parent_code) {
        current = themes.find(t => t.code === current.parent_code)!
      } else {
        break
      }
    }
    
    return hierarchy
  }, [theme, themes])
  
  if (!theme) {
    return (
      <div className="p-8">
        <p className="text-gray-500">Theme not found</p>
      </div>
    )
  }
  
  const handleExport = () => {
    exportToCSV(displayedComments, `theme-${themeCode}-comments.csv`)
  }
  
  const handleCopyIds = () => {
    const ids = displayedComments.map(c => c.id).join('\n')
    navigator.clipboard.writeText(ids)
  }
  
  return (
    <div className="space-y-6">
      {/* Breadcrumbs */}
      <Breadcrumbs items={[
        { label: 'Themes', path: '/themes' },
        { label: theme.code }
      ]} />
      
      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
          <div className="flex justify-between items-start">
            <div className="flex-1">
              <div className="flex items-center space-x-4 mb-2">
                <h2 className="text-2xl font-bold text-gray-900">{theme.code}</h2>
                <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-medium">
                  {theme.direct_count} {theme.direct_count === 1 ? 'comment' : 'comments'}
                </span>
              </div>
              {theme.label && (
                <h3 className="text-lg font-medium text-gray-700 mb-3">{theme.label}</h3>
              )}
              {theme.detailedDescription && (
                <div className="bg-blue-50 border-l-4 border-blue-200 pl-4 py-3 rounded-r-lg">
                  <p className="text-gray-700 text-sm leading-relaxed italic">
                    {theme.detailedDescription}
                  </p>
                </div>
              )}
              {!theme.detailedDescription && theme.description !== theme.label && (
                <div className="bg-blue-50 border-l-4 border-blue-200 pl-4 py-3 rounded-r-lg">
                  <p className="text-gray-700 text-sm leading-relaxed italic">
                    {theme.description}
                  </p>
                </div>
              )}
            </div>
            
            <div className="flex items-center space-x-2">
              <button
                onClick={handleCopyIds}
                className="flex items-center space-x-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
                title="Copy all comment IDs"
              >
                <Copy className="h-4 w-4" />
                <span>Copy IDs</span>
              </button>
              <button
                onClick={handleExport}
                className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                <Download className="h-4 w-4" />
                <span>Export CSV</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      
      {/* Theme Hierarchy */}
      {themeHierarchy.length > 1 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Theme Hierarchy</h3>
          <div className="flex items-center flex-wrap text-sm">
            {themeHierarchy.map((t, index) => (
              <div key={t.code} className="flex items-center">
                {index > 0 && <ChevronRight className="h-4 w-4 text-gray-400 mx-1" />}
                {index === themeHierarchy.length - 1 ? (
                  <span className="font-medium text-gray-900">
                    {t.code}: {t.label || t.description}
                  </span>
                ) : (
                  <Link 
                    to={`/themes/${t.code}`}
                    className="text-blue-600 hover:text-blue-800 hover:underline"
                  >
                    {t.code}: {t.label || t.description}
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Theme Summary Analysis */}
      {themeSummary && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">Theme Analysis</h2>
          <ThemeSummaryView summary={themeSummary} themeCode={theme.code} />
        </div>
      )}
      
      {/* Sub-themes */}
      {(() => {
        const childThemes = themes.filter(t => t.parent_code === theme.code && t.direct_count > 0)
        return childThemes.length > 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Sub-themes</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {childThemes.map(child => (
                <Link
                  key={child.code}
                  to={`/themes/${child.code}`}
                  className="bg-gray-50 rounded-lg border border-gray-200 p-4 hover:shadow-md hover:border-blue-300 transition-all"
                >
                  <h3 className="font-medium text-gray-900 mb-1">{child.code}</h3>
                  {child.label && (
                    <p className="text-sm text-gray-700 mb-2">{child.label}</p>
                  )}
                  {child.detailedDescription && (
                    <p className="text-xs text-gray-600 mb-3 italic">{child.detailedDescription}</p>
                  )}
                  {!child.detailedDescription && child.description !== child.label && (
                    <p className="text-xs text-gray-600 mb-3 italic">{child.description}</p>
                  )}
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-blue-600 font-medium">
                      {child.direct_count} {child.direct_count === 1 ? 'comment' : 'comments'}
                    </span>
                    <ChevronRight className="h-4 w-4 text-gray-400" />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ) : null
      })()}
      
      {/* Comments */}
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-gray-900">
          Comments Addressing This Theme ({displayedComments.length})
        </h2>
        
        {displayedComments.length > 0 ? (
          <div className="space-y-4">
            {displayedComments.map(comment => (
              <CommentCard 
                key={comment.id} 
                comment={comment} 
                showThemes={false}
              />
            ))}
          </div>
        ) : (
          <p className="text-gray-500 italic">No comments found addressing this theme</p>
        )}
      </div>
    </div>
  )
}

export default ThemeDetail 