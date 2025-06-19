import CommentLink from './CommentLink'

interface CommentAuthorLinkProps {
  commentId: string
  className?: string
  showIcon?: boolean
}

// Wrapper component for backward compatibility
function CommentAuthorLink({ commentId, className = '', showIcon = true }: CommentAuthorLinkProps) {
  return (
    <CommentLink 
      commentId={commentId} 
      className={className} 
      showIcon={showIcon}
    />
  )
}

export default CommentAuthorLink