import type { Theme, Comment } from '../types'

// Generate regulations.gov URL for a comment
export function getRegulationsGovUrl(_documentId: string, commentId: string): string {
  return `https://www.regulations.gov/comment/${commentId}`
}

// Get theme badge color based on relevance
export function getThemeBadgeColor(theme: Theme): string {
  const relevance = (theme.direct_count || 0) + (theme.touch_count || 0)
  if (relevance > 100) return 'bg-red-100 text-red-800 border-red-200'
  if (relevance > 50) return 'bg-orange-100 text-orange-800 border-orange-200'
  if (relevance > 20) return 'bg-yellow-100 text-yellow-800 border-yellow-200'
  return 'bg-gray-100 text-gray-800 border-gray-200'
}

// Format date for display
export function formatDate(dateString: string | undefined): string {
  if (!dateString) return 'Unknown date'
  try {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  } catch {
    return dateString
  }
}

// Extended Theme type for hierarchy
export interface ThemeWithChildren extends Theme {
  children: ThemeWithChildren[]
}

// Build theme hierarchy
export function buildThemeHierarchy(themes: Theme[]): ThemeWithChildren[] {
  const rootThemes = themes.filter(t => !t.parent_code)
  
  const addChildren = (theme: Theme): ThemeWithChildren => {
    const children = themes.filter(t => t.parent_code === theme.code)
    return {
      ...theme,
      children: children.map(addChildren)
    }
  }
  
  return rootThemes.map(addChildren)
}

// Export comments to CSV
export function exportToCSV(comments: Comment[], filename = 'comments.csv'): void {
  const headers = [
    'Comment ID',
    'Submitter',
    'Submitter Type',
    'Date',
    'Location',
    'Has Attachments',
    'Summary',
    'Theme Codes',
    'Entities',
    'Regulations.gov URL'
  ]
  
  const rows = comments.map(c => [
    c.id,
    c.submitter,
    c.submitterType,
    formatDate(c.date),
    c.location || '',
    c.hasAttachments ? 'Yes' : 'No',
    `"${(c.structuredSections?.oneLineSummary || '').replace(/"/g, '""')}"`,
    Object.entries(c.themeScores || {})
      .filter(([_, score]) => score <= 2)
      .map(([code, score]) => `${code}(${score})`)
      .join('; '),
    (c.entities || []).map(e => `${e.category}:${e.label}`).join('; '),
    getRegulationsGovUrl('', c.id)
  ])
  
  const csv = [
    headers.join(','),
    ...rows.map(row => row.join(','))
  ].join('\n')
  
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// Copy text to clipboard
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch (err) {
    console.error('Failed to copy:', err)
    return false
  }
}

// Get unique values from array of objects
export function getUniqueValues<T, K extends keyof T>(items: T[], key: K): T[K][] {
  const values = new Set<T[K]>()
  items.forEach(item => {
    const value = item[key]
    if (value !== undefined && value !== null) values.add(value)
  })
  return Array.from(values).sort()
}

// Parse theme description into label and detailed description
export function parseThemeDescription(description: string): { label: string; detailedDescription: string } {
  // Look for pattern: "Brief Label. Detailed description..."
  const match = description.match(/^([^.]+)\.\s*(.+)$/)
  
  if (match) {
    return {
      label: match[1].trim(),
      detailedDescription: match[2].trim()
    }
  }
  
  // Fallback if no period found or pattern doesn't match
  return {
    label: description,
    detailedDescription: ''
  }
} 