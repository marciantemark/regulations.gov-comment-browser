import { Link } from 'react-router-dom'
import { Building2, User } from 'lucide-react'
import useStore from '../store/useStore'

interface CommentLinkProps {
  commentId: string
  className?: string
  showIcon?: boolean
  showSubmitterType?: boolean
}

function CommentLink({ 
  commentId, 
  className = '', 
  showIcon = true,
  showSubmitterType = false 
}: CommentLinkProps) {
  const { getCommentById } = useStore()
  const comment = getCommentById(commentId)
  
  if (!comment) {
    return (
      <span className={`text-gray-500 ${className}`}>
        Comment {commentId}
      </span>
    )
  }
  
  const isOrganization = comment.submitterType === 'Organization' || 
                         comment.submitterType === 'Business' ||
                         comment.submitterType === 'Healthcare Organization' ||
                         comment.submitterType === 'Government Agency' ||
                         comment.submitterType === 'Trade Association'
  
  return (
    <Link
      to={`/comments/${commentId}`}
      className={`inline-flex items-center hover:underline ${className}`}
      title={`View comment by ${comment.submitter}${showSubmitterType ? ` (${comment.submitterType})` : ''}`}
    >
      {showIcon && (
        isOrganization ? (
          <Building2 className="h-3 w-3 mr-1 flex-shrink-0" />
        ) : (
          <User className="h-3 w-3 mr-1 flex-shrink-0" />
        )
      )}
      <span className="truncate max-w-[300px]">{comment.submitter}</span>
      {showSubmitterType && comment.submitterType && (
        <span className="text-gray-500 ml-1 text-xs">({comment.submitterType})</span>
      )}
    </Link>
  )
}

export default CommentLink