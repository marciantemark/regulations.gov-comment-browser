import { useState, useMemo, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Filter, MessageSquare, Copy } from 'lucide-react'
import useStore from '../store/useStore'
import CommentCard from './CommentCard'
import CopyCommentsModal from './CopyCommentsModal'
import { getUniqueValues } from '../utils/helpers'

function CommentBrowser() {
  const { comments, filters, setFilters, getFilteredComments, themes, entities } = useStore()
  const [searchParams] = useSearchParams()
  const [page, setPage] = useState(0)
  const [showFilters, setShowFilters] = useState(true)
  const [showCopyModal, setShowCopyModal] = useState(false)
  const ITEMS_PER_PAGE = 20
  
  // Apply URL query parameters to filters on mount
  useEffect(() => {
    const newFilters = { ...filters }
    
    // Check for submitterType parameter
    const submitterType = searchParams.get('submitterType')
    if (submitterType) {
      newFilters.submitterTypes = [submitterType]
    }
    
    // Check for hasAttachments parameter
    const hasAttachments = searchParams.get('hasAttachments')
    if (hasAttachments === 'true') {
      // We'll need to filter comments with attachments in the component
      // since it's not part of the standard filters
    }
    
    // Check for hasCondensed parameter
    const hasCondensed = searchParams.get('hasCondensed')
    if (hasCondensed) {
      newFilters.hasCondensed = hasCondensed as 'yes' | 'no' | 'all'
    }
    
    // Check for filter parameter (general purpose)
    const filterType = searchParams.get('filter')
    if (filterType === 'stakeholder') {
      setShowFilters(true)
    }
    
    setFilters(newFilters)
  }, [searchParams, setFilters])
  
  // Get filtered comments with additional attachment filter if needed
  const filteredComments = useMemo(() => {
    let filtered = getFilteredComments()
    
    // Apply attachment filter if specified in URL
    const hasAttachments = searchParams.get('hasAttachments')
    if (hasAttachments === 'true') {
      filtered = filtered.filter(c => c.hasAttachments)
    }
    
    return filtered
  }, [getFilteredComments, searchParams])
  
  // Get unique values for filters
  const filterOptions = useMemo(() => {
    const submitterTypes = getUniqueValues(comments, 'submitterType')
    const availableThemes = themes.filter(t => t.comment_count > 0).map(t => t.code)
    const availableEntities: string[] = []
    
    Object.entries(entities).forEach(([category, entityList]) => {
      entityList.forEach(entity => {
        if (entity.mentionCount > 0) {
          availableEntities.push(`${category}|${entity.label}`)
        }
      })
    })
    
    return { submitterTypes, themes: availableThemes, entities: availableEntities }
  }, [comments, themes, entities])
  
  // Pagination
  const totalPages = Math.ceil(filteredComments.length / ITEMS_PER_PAGE)
  const paginatedComments = filteredComments.slice(
    page * ITEMS_PER_PAGE,
    (page + 1) * ITEMS_PER_PAGE
  )
  
  const commentsToCopy = filteredComments

  const handleFilterChange = (type: keyof typeof filters, value: any) => {
    setFilters({ ...filters, [type]: value })
    setPage(0) // Reset to first page when filters change
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <MessageSquare className="h-6 w-6 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Browse Comments</h1>
              <p className="text-sm text-gray-500 mt-1">
                Showing {filteredComments.length} of {comments.length} comments
                {searchParams.get('hasAttachments') === 'true' && ' with attachments'}
                {searchParams.get('submitterType') && ` from ${searchParams.get('submitterType')}`}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowCopyModal(true)}
              className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Copy className="h-4 w-4" />
              <span>Copy for LLM</span>
            </button>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center space-x-2 px-4 py-2 border rounded-lg hover:bg-gray-50"
            >
              <Filter className="h-4 w-4" />
              <span>{showFilters ? 'Hide' : 'Show'} Filters</span>
            </button>
          </div>
        </div>
      </div>
      
      {/* Filters */}
      {showFilters && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold mb-4">Filters</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Submitter Type Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Submitter Type
              </label>
              <select
                multiple
                value={filters.submitterTypes}
                onChange={(e) => {
                  const selected = Array.from(e.target.selectedOptions, option => option.value)
                  handleFilterChange('submitterTypes', selected)
                }}
                className="w-full border rounded-lg p-2 h-32"
              >
                {filterOptions.submitterTypes.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
            
            {/* Theme Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Themes
              </label>
              <select
                multiple
                value={filters.themes}
                onChange={(e) => {
                  const selected = Array.from(e.target.selectedOptions, option => option.value)
                  handleFilterChange('themes', selected)
                }}
                className="w-full border rounded-lg p-2 h-32"
              >
                {filterOptions.themes.map(code => {
                  const theme = themes.find(t => t.code === code)
                  return (
                    <option key={code} value={code}>
                      {code}. {theme?.description || code}
                    </option>
                  )
                })}
              </select>
            </div>
            
            {/* Has Condensed Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Has Summary
              </label>
              <select
                value={filters.hasCondensed}
                onChange={(e) => handleFilterChange('hasCondensed', e.target.value)}
                className="w-full border rounded-lg p-2"
              >
                <option value="all">All Comments</option>
                <option value="yes">With Summary</option>
                <option value="no">Without Summary</option>
              </select>
            </div>
          </div>
          
          {(filters.submitterTypes.length > 0 || filters.themes.length > 0) && (
            <button
              onClick={() => setFilters({
                ...filters,
                submitterTypes: [],
                themes: [],
                entities: [],
                hasCondensed: 'all'
              })}
              className="mt-4 text-sm text-blue-600 hover:text-blue-800"
            >
              Clear all filters
            </button>
          )}
        </div>
      )}
      
      {/* Comments List */}
      <div className="space-y-4">
        {paginatedComments.length > 0 ? (
          paginatedComments.map(comment => (
            <CommentCard key={comment.id} comment={comment} showThemes={false} showEntities={false} />
          ))
        ) : (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
            <p className="text-gray-500">No comments match your filters</p>
          </div>
        )}
      </div>
      
      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center items-center space-x-2">
          <button
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
            className="px-4 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          
          <span className="text-sm text-gray-600">
            Page {page + 1} of {totalPages}
          </span>
          
          <button
            onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
            disabled={page === totalPages - 1}
            className="px-4 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}
      
      {/* Copy Modal */}
      <CopyCommentsModal
        isOpen={showCopyModal}
        onClose={() => setShowCopyModal(false)}
        title={`Copy ${commentsToCopy.length} Comments for LLM`}
        comments={commentsToCopy}
      />
    </div>
  )
}

export default CommentBrowser