import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { FileText, Search, TrendingUp, AlertCircle, CheckCircle } from 'lucide-react'
import useStore from '../store/useStore'

function ThemeSummaries() {
  const { themes, themeSummaries } = useStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'consensus' | 'debate' | 'insights'>('all')
  
  // Get themes that have summaries
  const themesWithSummaries = useMemo(() => {
    return themes.filter(theme => themeSummaries[theme.code])
      .map(theme => ({
        ...theme,
        summary: themeSummaries[theme.code]
      }))
      .sort((a, b) => b.summary.commentCount - a.summary.commentCount)
  }, [themes, themeSummaries])
  
  // Filter themes based on search and category
  const filteredThemes = useMemo(() => {
    let filtered = themesWithSummaries
    
    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(theme => 
        theme.code.toLowerCase().includes(query) ||
        theme.label?.toLowerCase().includes(query) ||
        theme.description.toLowerCase().includes(query) ||
        theme.summary.sections.executiveSummary?.toLowerCase().includes(query)
      )
    }
    
    // Apply category filter
    if (selectedCategory !== 'all') {
      filtered = filtered.filter(theme => {
        const { sections } = theme.summary
        switch (selectedCategory) {
          case 'consensus':
            return sections.consensusPoints && sections.consensusPoints.length > 0
          case 'debate':
            return sections.areasOfDebate && sections.areasOfDebate.length > 0
          case 'insights':
            return sections.noteworthyInsights && sections.noteworthyInsights.length > 0
          default:
            return true
        }
      })
    }
    
    return filtered
  }, [themesWithSummaries, searchQuery, selectedCategory])
  
  const categories = [
    { id: 'all', label: 'All Summaries', icon: FileText, color: 'gray' },
    { id: 'consensus', label: 'With Consensus', icon: CheckCircle, color: 'green' },
    { id: 'debate', label: 'With Debates', icon: AlertCircle, color: 'red' },
    { id: 'insights', label: 'With Insights', icon: TrendingUp, color: 'amber' }
  ]
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center space-x-3">
          <FileText className="h-6 w-6 text-purple-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Theme Analysis Summaries</h1>
            <p className="text-sm text-gray-500 mt-1">
              {themesWithSummaries.length} of {themes.length} themes have detailed analysis
            </p>
          </div>
        </div>
      </div>
      
      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div className="flex flex-col md:flex-row gap-4">
          {/* Search */}
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search theme summaries..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
            </div>
          </div>
          
          {/* Category Filter */}
          <div className="flex gap-2">
            {categories.map(cat => {
              const Icon = cat.icon
              const isActive = selectedCategory === cat.id
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id as any)}
                  className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors ${
                    isActive
                      ? `bg-${cat.color}-100 text-${cat.color}-800 border-${cat.color}-300`
                      : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                  } border`}
                >
                  <Icon className="h-4 w-4" />
                  <span className="text-sm font-medium">{cat.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
      
      {/* Summary Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {filteredThemes.map(theme => {
          const { sections } = theme.summary
          const hasConsensus = sections.consensusPoints && sections.consensusPoints.length > 0
          const hasDebate = sections.areasOfDebate && sections.areasOfDebate.length > 0
          const hasInsights = sections.noteworthyInsights && sections.noteworthyInsights.length > 0
          
          return (
            <Link
              key={theme.code}
              to={`/themes/${theme.code}`}
              className="bg-white rounded-lg shadow-sm border border-gray-200 hover:shadow-lg hover:border-purple-300 transition-all overflow-hidden"
            >
              <div className="p-6">
                {/* Theme Header */}
                <div className="mb-4">
                  <h3 className="text-lg font-semibold text-gray-900 mb-1">
                    {theme.code}: {theme.label || theme.description}
                  </h3>
                  <div className="flex items-center space-x-4 text-sm text-gray-500">
                    <span>{theme.summary.commentCount} comments analyzed</span>
                    <span>•</span>
                    <span>{theme.direct_count} direct mentions</span>
                  </div>
                </div>
                
                {/* Executive Summary */}
                {sections.executiveSummary && (
                  <p className="text-gray-700 text-sm mb-4 line-clamp-3">
                    {sections.executiveSummary}
                  </p>
                )}
                
                {/* Key Highlights */}
                <div className="space-y-3">
                  {hasConsensus && (
                    <div className="flex items-start space-x-2">
                      <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-green-900">
                          {sections.consensusPoints!.length} consensus points
                        </p>
                        <p className="text-xs text-gray-600 line-clamp-2">
                          {sections.consensusPoints![0].text}
                        </p>
                      </div>
                    </div>
                  )}
                  
                  {hasDebate && (
                    <div className="flex items-start space-x-2">
                      <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-red-900">
                          {sections.areasOfDebate!.length} areas of debate
                        </p>
                        <p className="text-xs text-gray-600 line-clamp-2">
                          {sections.areasOfDebate![0].topic}: {sections.areasOfDebate![0].description}
                        </p>
                      </div>
                    </div>
                  )}
                  
                  {hasInsights && (
                    <div className="flex items-start space-x-2">
                      <TrendingUp className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-amber-900">
                          {sections.noteworthyInsights!.length} key insights
                        </p>
                        <p className="text-xs text-gray-600 line-clamp-2">
                          {typeof sections.noteworthyInsights![0] === 'string' 
                            ? sections.noteworthyInsights![0] 
                            : sections.noteworthyInsights![0].insight}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
                
                {/* View More */}
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <span className="text-sm text-purple-600 font-medium">
                    View full analysis →
                  </span>
                </div>
              </div>
            </Link>
          )
        })}
      </div>
      
      {filteredThemes.length === 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
          <p className="text-gray-500">No theme summaries match your filters</p>
        </div>
      )}
    </div>
  )
}

export default ThemeSummaries 