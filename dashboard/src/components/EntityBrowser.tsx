import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Tag, ChevronRight } from 'lucide-react'
import useStore from '../store/useStore'

function EntityBrowser() {
  const { entities } = useStore()
  const [selectedCategory, setSelectedCategory] = useState<string>(Object.keys(entities)[0] || '')
  
  const categories = Object.keys(entities).sort()
  
  // User-friendly category names
  const getCategoryDisplayName = (category: string): string => {
    const displayNames: Record<string, string> = {
      'Organizations': 'Organizations & Agencies',
      'Medications': 'Medications & Treatments',
      'Conditions': 'Medical Conditions',
      'Regulations': 'Laws & Regulations',
      'Programs': 'Programs & Initiatives',
      'Locations': 'Places & Regions'
    }
    return displayNames[category] || category
  }
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center space-x-3">
          <Tag className="h-6 w-6 text-green-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Browse Topics & Organizations</h1>
            <p className="text-sm text-gray-500 mt-1">
              Explore key topics, organizations, and subjects mentioned in comments
            </p>
          </div>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Category List */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="p-4 border-b border-gray-200">
            <div className="flex items-center space-x-2">
              <Tag className="h-5 w-5 text-gray-400" />
              <h3 className="font-semibold">Categories</h3>
            </div>
          </div>
          <div className="p-2">
            {categories.map(category => {
              const entityCount = entities[category]?.length || 0
              const totalMentions = entities[category]?.reduce((sum, e) => sum + e.mentionCount, 0) || 0
              
              return (
                <button
                  key={category}
                  onClick={() => setSelectedCategory(category)}
                  className={`w-full text-left px-4 py-3 rounded transition-colors ${
                    selectedCategory === category
                      ? 'bg-green-50 text-green-700 border-l-4 border-green-600'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <span className="font-medium">{getCategoryDisplayName(category)}</span>
                    <span className="text-sm text-gray-500">{entityCount}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {totalMentions.toLocaleString()} total mentions
                  </p>
                </button>
              )
            })}
          </div>
        </div>

        {/* Entity List */}
        <div className="md:col-span-2 bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="p-4 border-b border-gray-200">
            <h3 className="font-semibold text-lg">{getCategoryDisplayName(selectedCategory)}</h3>
            <p className="text-sm text-gray-500 mt-1">
              {entities[selectedCategory]?.length || 0} topics in this category
            </p>
          </div>
          <div className="divide-y divide-gray-200 max-h-[600px] overflow-y-auto">
            {selectedCategory && entities[selectedCategory]?.map(entity => (
              <Link
                key={entity.label}
                to={`/entities/${encodeURIComponent(selectedCategory)}/${encodeURIComponent(entity.label)}`}
                className="block p-4 hover:bg-gray-50 transition-colors group"
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h4 className="font-medium text-gray-900 group-hover:text-green-600 transition-colors">
                      {entity.label}
                    </h4>
                    <p className="text-sm text-gray-600 mt-1">{entity.definition}</p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {entity.terms.slice(0, 3).map((term, i) => (
                        <span key={i} className="text-xs bg-gray-100 px-2 py-1 rounded">
                          "{term}"
                        </span>
                      ))}
                      {entity.terms.length > 3 && (
                        <span className="text-xs text-gray-500 px-2 py-1">
                          +{entity.terms.length - 3} more
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center space-x-2 ml-4">
                    <span className="text-sm text-gray-500">
                      {entity.mentionCount} {entity.mentionCount === 1 ? 'mention' : 'mentions'}
                    </span>
                    <ChevronRight className="h-4 w-4 text-gray-400 group-hover:text-green-600 transition-colors" />
                  </div>
                </div>
              </Link>
            ))}
            
            {(!selectedCategory || !entities[selectedCategory] || entities[selectedCategory].length === 0) && (
              <div className="p-8 text-center text-gray-500">
                No topics in this category
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default EntityBrowser 