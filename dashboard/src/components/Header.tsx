import { Search, FileText, Download } from 'lucide-react'
import useStore from '../store/useStore'
import { exportToCSV } from '../utils/helpers'

function Header() {
  const { meta, searchQuery, setSearchQuery, filters, setFilters, getFilteredComments } = useStore()
  
  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value
    setSearchQuery(query)
    setFilters({ ...filters, searchQuery: query })
  }
  
  const handleExport = () => {
    const comments = getFilteredComments()
    const filename = `comments-${meta?.documentId || 'export'}-${new Date().toISOString().split('T')[0]}.csv`
    exportToCSV(comments, filename)
  }

  return (
    <header className="bg-white shadow-sm border-b">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center py-4">
          <div className="flex items-center space-x-3">
            <FileText className="h-8 w-8 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Comment Analysis Dashboard</h1>
              <p className="text-sm text-gray-500">
                Document: {meta?.documentId || 'Loading...'}
                {meta?.stats && (
                  <span className="ml-2">
                    • {meta.stats.totalComments.toLocaleString()} comments
                  </span>
                )}
              </p>
            </div>
          </div>
          
          <div className="flex items-center space-x-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
              <input
                type="text"
                placeholder="Search comments..."
                className="pl-10 pr-4 py-2 w-64 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={searchQuery}
                onChange={handleSearch}
              />
            </div>
            
            <button
              onClick={handleExport}
              className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Download className="h-4 w-4" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}

export default Header 