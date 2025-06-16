import { AlertCircle } from 'lucide-react'

interface ErrorScreenProps {
  error: string | null
}

function ErrorScreen({ error }: ErrorScreenProps) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center max-w-md">
        <AlertCircle className="h-12 w-12 text-red-600 mx-auto" />
        <h2 className="mt-4 text-xl font-semibold text-gray-900">Failed to Load Data</h2>
        <p className="mt-2 text-gray-600">{error || 'An unexpected error occurred'}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Reload Page
        </button>
      </div>
    </div>
  )
}

export default ErrorScreen 