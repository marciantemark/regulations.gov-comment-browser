import { FileText } from 'lucide-react'
import useStore from '../store/useStore'

function Header() {
  const { meta } = useStore()

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
        </div>
      </div>
    </header>
  )
}

export default Header 