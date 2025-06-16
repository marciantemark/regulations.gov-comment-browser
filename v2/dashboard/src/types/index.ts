export interface Meta {
  documentId: string
  generatedAt: string
  stats: {
    totalComments: number
    condensedComments: number
    totalThemes: number
    totalEntities: number
    scoredComments: number
  }
}

export interface Theme {
  code: string
  parent_code: string | null
  description: string
  label?: string  // Brief theme label (parsed from description)
  detailedDescription?: string  // Detailed description (parsed from description)
  quotes_json?: string
  quotes?: Array<{
    quote: string
    comment_id: string
  }>
  comment_count: number
  direct_count: number
  touch_count: number
}

export interface Entity {
  label: string
  definition: string
  terms: string[]
  mentionCount: number
}

export interface EntityTaxonomy {
  [category: string]: Entity[]
}

export interface Comment {
  id: string
  submitter: string
  submitterType: string
  date: string
  location?: string
  structuredSections?: {
    oneLineSummary?: string
    commenterProfile?: string
    corePosition?: string
    keyRecommendations?: string
    mainConcerns?: string
    notableExperiences?: string
    keyQuotations?: string
    detailedContent?: string
  }
  themeScores?: Record<string, number>
  entities?: Array<{
    category: string
    label: string
  }>
  hasAttachments: boolean
  documentId?: string
}

export interface ThemeIndex {
  [themeCode: string]: {
    direct: string[]
    touches: string[]
  }
}

export interface EntityIndex {
  [entityKey: string]: string[]
}

export interface Filters {
  themes: string[]
  entities: string[]
  submitterTypes: string[]
  hasCondensed: 'all' | 'yes' | 'no'
  searchQuery: string
}

export interface StoreState {
  // Core data
  meta: Meta | null
  themes: Theme[]
  entities: EntityTaxonomy
  comments: Comment[]
  themeIndex: ThemeIndex
  entityIndex: EntityIndex
  
  // UI state
  selectedView: 'overview' | 'themes' | 'entities' | 'comments'
  selectedTheme: Theme | null
  selectedEntity: (Entity & { category: string }) | null
  searchQuery: string
  loading: boolean
  error: string | null
  
  // Filters
  filters: Filters
  
  // Actions
  setData: (data: Partial<StoreState>) => void
  setSelectedView: (view: StoreState['selectedView']) => void
  setSelectedTheme: (theme: Theme | null) => void
  setSelectedEntity: (entity: (Entity & { category: string }) | null) => void
  setSearchQuery: (query: string) => void
  setFilters: (filters: Filters) => void
  loadData: () => Promise<void>
  
  // Computed getters
  getFilteredComments: () => Comment[]
  getCommentsForTheme: (themeCode: string) => { direct: Comment[], touches: Comment[] }
  getCommentsForEntity: (category: string, label: string) => Comment[]
} 