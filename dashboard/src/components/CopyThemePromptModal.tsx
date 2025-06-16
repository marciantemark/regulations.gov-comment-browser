import { useState, useEffect } from 'react'
import { X, Copy, Check } from 'lucide-react'
import { Comment, Theme, ThemeSummary } from '../types'

interface CopyThemePromptModalProps {
  isOpen: boolean
  onClose: () => void
  theme: Theme
  comments: Comment[]
  summary?: ThemeSummary
}

interface SectionOptions {
  detailedContent: boolean
  executiveSummary: boolean
  consensusPoints: boolean
  areasOfDebate: boolean
  stakeholderPerspectives: boolean
  noteworthyInsights: boolean
  emergingPatterns: boolean
  keyQuotations: boolean
  analyticalNotes: boolean
}

function CopyThemePromptModal({ isOpen, onClose, theme, comments, summary }: CopyThemePromptModalProps) {
  const [copied, setCopied] = useState(false)
  const [sections, setSections] = useState<SectionOptions>({
    detailedContent: true,
    executiveSummary: false,
    consensusPoints: false,
    areasOfDebate: false,
    stakeholderPerspectives: false,
    noteworthyInsights: false,
    emergingPatterns: false,
    keyQuotations: false,
    analyticalNotes: false
  })

  useEffect(() => {
    if (!isOpen) {
      setCopied(false)
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleSectionToggle = (section: keyof SectionOptions) => {
    setSections(prev => ({ ...prev, [section]: !prev[section] }))
  }

  const formatComment = (comment: Comment) => {
    const metadata = [
      comment.submitter,
      comment.submitterType,
      comment.date,
      comment.location
    ].filter(Boolean).join(' | ')

    const sections = comment.structuredSections || {}
    
    // Always include detailedContent
    let content = sections.detailedContent || 'No detailed content available'
    
    return `<comment id="${comment.id}" metadata="${metadata}">
${content}
</comment>`
  }

  const buildPromptContent = () => {
    let prompt = `# Theme Analysis: ${theme.code} - ${theme.label || theme.description}\n\n`
    
    if (theme.detailedDescription) {
      prompt += `## Theme Description\n${theme.detailedDescription}\n\n`
    }

    // Add summary sections if available and selected
    if (summary) {
      const { sections: sumSections } = summary
      
      if (sections.executiveSummary && sumSections.executiveSummary) {
        prompt += `## Executive Summary\n${sumSections.executiveSummary}\n\n`
      }
      
      if (sections.consensusPoints && sumSections.consensusPoints) {
        prompt += `## Consensus Points\n`
        sumSections.consensusPoints.forEach(point => {
          prompt += `- ${point.text}\n`
          if (point.supportLevel) prompt += `  Support Level: ${point.supportLevel}\n`
          if (point.evidence) {
            point.evidence.forEach(ev => prompt += `  - ${ev}\n`)
          }
        })
        prompt += '\n'
      }
      
      if (sections.areasOfDebate && sumSections.areasOfDebate) {
        prompt += `## Areas of Debate\n`
        sumSections.areasOfDebate.forEach(debate => {
          prompt += `### ${debate.topic}\n${debate.description}\n`
          debate.positions.forEach(pos => {
            prompt += `- **${pos.label}:** ${pos.stance}\n`
            if (pos.supportLevel) prompt += `  Support Level: ${pos.supportLevel}\n`
            pos.keyArguments.forEach(arg => prompt += `  - ${arg}\n`)
          })
          if (debate.middleGround) prompt += `- **Middle Ground:** ${debate.middleGround}\n`
        })
        prompt += '\n'
      }
      
      if (sections.stakeholderPerspectives && sumSections.stakeholderPerspectives) {
        prompt += `## Stakeholder Perspectives\n`
        sumSections.stakeholderPerspectives.forEach(stakeholder => {
          prompt += `### ${stakeholder.stakeholderType}\n${stakeholder.primaryConcerns}\n`
          stakeholder.specificPoints.forEach(point => prompt += `- ${point}\n`)
        })
        prompt += '\n'
      }
      
      if (sections.noteworthyInsights && sumSections.noteworthyInsights) {
        prompt += `## Noteworthy Insights\n`
        sumSections.noteworthyInsights.forEach(insight => {
          if (typeof insight === 'string') {
            prompt += `- ${insight}\n`
          } else {
            prompt += `- ${insight.insight}`
            if (insight.source) prompt += ` (Source: ${insight.source})`
            prompt += '\n'
          }
        })
        prompt += '\n'
      }
      
      if (sections.emergingPatterns && sumSections.emergingPatterns) {
        prompt += `## Emerging Patterns\n`
        sumSections.emergingPatterns.forEach(pattern => {
          if (typeof pattern === 'string') {
            prompt += `- ${pattern}\n`
          } else {
            prompt += `- ${pattern.pattern}`
            if (pattern.category) prompt += ` [${pattern.category}]`
            prompt += '\n'
          }
        })
        prompt += '\n'
      }
      
      if (sections.keyQuotations && sumSections.keyQuotations) {
        prompt += `## Key Quotations\n`
        sumSections.keyQuotations.forEach(quote => {
          if (typeof quote === 'string') {
            prompt += `- ${quote}\n`
          } else {
            prompt += `- "${quote.quote}" - ${quote.source}`
            if (quote.sourceType) prompt += ` (${quote.sourceType})`
            prompt += '\n'
          }
        })
        prompt += '\n'
      }
      
      if (sections.analyticalNotes && sumSections.analyticalNotes) {
        prompt += `## Analytical Notes\n`
        const notes = sumSections.analyticalNotes
        if (notes.discourseQuality) {
          prompt += `- **Discourse Quality:** ${notes.discourseQuality.level} - ${notes.discourseQuality.explanation}\n`
        }
        if (notes.evidenceBase) {
          prompt += `- **Evidence Base:** ${notes.evidenceBase.level} - ${notes.evidenceBase.explanation}\n`
        }
        if (notes.representationGaps) {
          prompt += `- **Representation Gaps:** ${notes.representationGaps}\n`
        }
        if (notes.complexityLevel) {
          prompt += `- **Complexity Level:** ${notes.complexityLevel}\n`
        }
        prompt += '\n'
      }
    }
    
    // Add comments
    prompt += `## Comments (${comments.length})\n\n`
    comments.forEach(comment => {
      prompt += formatComment(comment) + '\n\n'
    })
    
    return prompt
  }

  const handleCopy = async () => {
    const content = buildPromptContent()
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  return (
    <>
      {/* Modal backdrop */}
      <div 
        className="fixed inset-0 bg-black bg-opacity-50 z-40"
        onClick={onClose}
      />
      
      {/* Modal content */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">
              Copy Theme Comments for LLM
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          
          {/* Content */}
          <div className="p-6 overflow-y-auto max-h-[60vh]">
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">
                  Theme: {theme.code} - {theme.label || theme.description}
                </h3>
                <p className="text-sm text-gray-500">
                  {comments.length} comments will be included
                </p>
              </div>
              
              {summary && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-3">
                    Include Analysis Sections:
                  </h3>
                  <div className="space-y-2">
                    <label className="flex items-center space-x-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={sections.detailedContent}
                        onChange={() => handleSectionToggle('detailedContent')}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        disabled
                      />
                      <span className="text-sm text-gray-700">
                        Comment Details <span className="text-gray-500">(always included)</span>
                      </span>
                    </label>
                    
                    {summary.sections.executiveSummary && (
                      <label className="flex items-center space-x-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={sections.executiveSummary}
                          onChange={() => handleSectionToggle('executiveSummary')}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <span className="text-sm text-gray-700">Executive Summary</span>
                      </label>
                    )}
                    
                    {summary.sections.consensusPoints && (
                      <label className="flex items-center space-x-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={sections.consensusPoints}
                          onChange={() => handleSectionToggle('consensusPoints')}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <span className="text-sm text-gray-700">Consensus Points</span>
                      </label>
                    )}
                    
                    {summary.sections.areasOfDebate && (
                      <label className="flex items-center space-x-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={sections.areasOfDebate}
                          onChange={() => handleSectionToggle('areasOfDebate')}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <span className="text-sm text-gray-700">Areas of Debate</span>
                      </label>
                    )}
                    
                    {summary.sections.stakeholderPerspectives && (
                      <label className="flex items-center space-x-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={sections.stakeholderPerspectives}
                          onChange={() => handleSectionToggle('stakeholderPerspectives')}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <span className="text-sm text-gray-700">Stakeholder Perspectives</span>
                      </label>
                    )}
                    
                    {summary.sections.noteworthyInsights && (
                      <label className="flex items-center space-x-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={sections.noteworthyInsights}
                          onChange={() => handleSectionToggle('noteworthyInsights')}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <span className="text-sm text-gray-700">Noteworthy Insights</span>
                      </label>
                    )}
                    
                    {summary.sections.emergingPatterns && (
                      <label className="flex items-center space-x-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={sections.emergingPatterns}
                          onChange={() => handleSectionToggle('emergingPatterns')}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <span className="text-sm text-gray-700">Emerging Patterns</span>
                      </label>
                    )}
                    
                    {summary.sections.keyQuotations && (
                      <label className="flex items-center space-x-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={sections.keyQuotations}
                          onChange={() => handleSectionToggle('keyQuotations')}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <span className="text-sm text-gray-700">Key Quotations</span>
                      </label>
                    )}
                    
                    {summary.sections.analyticalNotes && (
                      <label className="flex items-center space-x-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={sections.analyticalNotes}
                          onChange={() => handleSectionToggle('analyticalNotes')}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <span className="text-sm text-gray-700">Analytical Notes</span>
                      </label>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          
          {/* Footer */}
          <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCopy}
              className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4" />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  <span>Copy to Clipboard</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

export default CopyThemePromptModal 