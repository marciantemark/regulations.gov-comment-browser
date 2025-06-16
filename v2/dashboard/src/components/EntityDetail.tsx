import { useParams, Link } from 'react-router-dom'
import { Tag, Download } from 'lucide-react'
import useStore from '../store/useStore'
import CommentCard from './CommentCard'
import { exportToCSV } from '../utils/helpers'
import { useMemo } from 'react'
import Breadcrumbs from './Breadcrumbs'

function EntityDetail() {
  const { category, label } = useParams<{ category: string; label: string }>()
  const { entities, getCommentsForEntity, themes } = useStore()
  
  const entity = category && label && entities[category]?.find(e => e.label === label)
  const comments = category && label ? getCommentsForEntity(category, label) : []
  
  // Calculate theme distribution for these comments
  const themeDistribution = useMemo(() => {
    const distribution: Record<string, number> = {}
    
    for (const comment of comments) {
      if (comment.themeScores) {
        for (const [theme, score] of Object.entries(comment.themeScores)) {
          // Only count themes with score = 1 (directly addresses)
          if (score === 1) {
            distribution[theme] = (distribution[theme] || 0) + 1
          }
        }
      }
    }
    
    return Object.entries(distribution)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10) // Top 10 themes
  }, [comments])
  
  if (!entity) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[
          { label: 'Topics', path: '/entities' },
          { label: category || 'Unknown' },
          { label: 'Not Found' }
        ]} />
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
          <p className="text-gray-500">Topic not found</p>
        </div>
      </div>
    )
  }
  
  const handleExport = () => {
    exportToCSV(comments, `topic-${category}-${label}-comments.csv`)
  }
  
  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Topics', path: '/entities' },
        { label: category, path: `/entities/${encodeURIComponent(category)}` },
        { label: entity.label }
      ]} />

      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
          <div className="flex justify-between items-start">
            <div>
              <div className="flex items-center space-x-3 mb-2">
                <Tag className="h-6 w-6 text-green-600" />
                <h1 className="text-2xl font-bold text-gray-900">{entity.label}</h1>
                <Link
                  to={`/entities/${encodeURIComponent(category)}`}
                  className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                >
                  Category: {category}
                </Link>
              </div>
              <p className="text-gray-600">{entity.definition}</p>
              {entity.terms.length > 1 && (
                <div className="mt-2">
                  <span className="text-sm text-gray-500">Also known as: </span>
                  <span className="text-sm text-gray-700">
                    {entity.terms.filter(t => t !== entity.label).join(', ')}
                  </span>
                </div>
              )}
              <div className="mt-3">
                <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
                  {comments.length} mentions
                </span>
              </div>
            </div>
            
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
      
      {/* Theme Distribution */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Key Themes in These Comments</h3>
        {themeDistribution.length > 0 ? (
          <div className="space-y-3">
            {themeDistribution.map(([themeCode, count]) => {
              const theme = themes.find(t => t.code === themeCode)
              return (
                <div key={themeCode} className="flex items-center justify-between">
                  <Link
                    to={`/themes/${themeCode}`}
                    className="text-blue-600 hover:text-blue-800 hover:underline flex-1"
                  >
                    <span className="font-medium">{theme?.label || themeCode}</span>
                  </Link>
                  <span className="text-gray-600 ml-4">
                    {count} {count === 1 ? 'comment' : 'comments'}
                  </span>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-gray-500 italic">No primary themes identified in these comments</p>
        )}
      </div>
      
      {/* Comments */}
      {comments.length > 0 ? (
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Comments Mentioning This Topic ({comments.length})
          </h2>
          <div className="space-y-4">
            {comments.map(comment => (
              <CommentCard key={comment.id} comment={comment} />
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
          <p className="text-gray-500">No comments found mentioning this topic</p>
        </div>
      )}
    </div>
  )
}

export default EntityDetail 