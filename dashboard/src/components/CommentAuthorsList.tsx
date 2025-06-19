import CommentAuthorLink from './CommentAuthorLink'

interface CommentAuthorsListProps {
  commentIds: string[] | null | undefined
  className?: string
  separator?: string
  showIcons?: boolean
  maxDisplay?: number
}

function CommentAuthorsList({ 
  commentIds, 
  className = '', 
  separator = ', ',
  showIcons = true,
  maxDisplay
}: CommentAuthorsListProps) {
  if (!commentIds || commentIds.length === 0) {
    return null
  }
  
  const displayIds = maxDisplay ? commentIds.slice(0, maxDisplay) : commentIds
  const remaining = maxDisplay ? commentIds.length - maxDisplay : 0
  
  return (
    <div className={`inline-flex items-center flex-wrap gap-1 ${className}`}>
      {displayIds.map((id, index) => (
        <span key={id} className="inline-flex items-center">
          <CommentAuthorLink 
            commentId={id} 
            className="text-xs text-gray-600 hover:text-blue-600"
            showIcon={showIcons}
          />
          {index < displayIds.length - 1 && (
            <span className="text-gray-400 mx-1">{separator}</span>
          )}
        </span>
      ))}
      {remaining > 0 && (
        <span className="text-xs text-gray-500 ml-1">
          +{remaining} more
        </span>
      )}
    </div>
  )
}

export default CommentAuthorsList