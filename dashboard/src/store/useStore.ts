import { create } from 'zustand'
import type { Meta, Theme, Entity, Comment, ThemeIndex, EntityIndex, ThemeSummary } from '../types'
import { parseThemeDescription } from '../utils/helpers'

interface FilterOptions {
  themes: string[]
  entities: string[]
  submitterTypes: string[]
  hasCondensed: 'all' | 'yes' | 'no'
  searchQuery: string
}

interface StoreState {
  loading: boolean
  error: string | null
  meta: Meta | null
  themes: Theme[]
  themeSummaries: Record<string, ThemeSummary>
  entities: Record<string, Entity[]>
  comments: Comment[]
  filters: FilterOptions
  searchQuery: string
  themeIndex: ThemeIndex
  entityIndex: EntityIndex
  organizationCategory: string | null
  
  // UI state
  selectedView: string
  selectedTheme: Theme | null
  selectedEntity: { category: string; label: string } | null
  
  // Actions
  loadData: () => Promise<void>
  setFilters: (filters: FilterOptions) => void
  setSearchQuery: (query: string) => void
  setData: (data: any) => void
  setSelectedView: (view: string) => void
  setSelectedTheme: (theme: Theme | null) => void
  setSelectedEntity: (entity: { category: string; label: string } | null) => void
  
  // Computed
  getCommentsForTheme: (themeCode: string) => { direct: Comment[], touches: Comment[] }
  getCommentsForEntity: (category: string, label: string) => Comment[]
  getFilteredComments: () => Comment[]
}

const useStore = create<StoreState>((set, get) => ({
  // Core data
  meta: null,
  themes: [],
  themeSummaries: {},
  entities: {},
  comments: [],
  themeIndex: {},
  entityIndex: {},
  organizationCategory: null,
  
  // UI state
  selectedView: 'overview',
  selectedTheme: null,
  selectedEntity: null,
  searchQuery: '',
  loading: true,
  error: null,
  
  // Filters
  filters: {
    themes: [],
    entities: [],
    submitterTypes: [],
    hasCondensed: 'all' as const,
    searchQuery: ''
  },
  
  // Actions
  setData: (data: any) => set(data),
  setSelectedView: (view: string) => set({ selectedView: view }),
  setSelectedTheme: (theme: Theme | null) => set({ selectedTheme: theme }),
  setSelectedEntity: (entity: { category: string; label: string } | null) => set({ selectedEntity: entity }),
  setSearchQuery: (query: string) => set({ searchQuery: query }),
  setFilters: (filters: FilterOptions) => set({ filters }),
  
  // Load all data
  loadData: async () => {
    set({ loading: true, error: null })
    
    try {
      const [meta, themes, themeSummaries, entities, comments, themeIndex, entityIndex] = await Promise.all([
        fetch('./data/meta.json').then(r => r.json()),
        fetch('./data/themes.json').then(r => r.json()),
        fetch('./data/theme-summaries.json').then(r => r.json()),
        fetch('./data/entities.json').then(r => r.json()),
        fetch('./data/comments.json').then(r => r.json()),
        fetch('./data/indexes/theme-comments.json').then(r => r.json()),
        fetch('./data/indexes/entity-comments.json').then(r => r.json()),
      ])
      
      // Parse theme descriptions
      const parsedThemes = themes.map((theme: Theme) => {
        const { label, detailedDescription } = parseThemeDescription(theme.description)
        return {
          ...theme,
          label,
          detailedDescription
        }
      })
      
      // After loading themeSummaries and entities
      // Determine the organization category by sampling
      const orgCategory = determineOrganizationCategory(themeSummaries, entities)
      
      set({
        meta,
        themes: parsedThemes,
        themeSummaries,
        entities,
        comments,
        themeIndex,
        entityIndex,
        organizationCategory: orgCategory,
        loading: false,
        error: null,
      })
    } catch (error) {
      console.error('Failed to load data:', error)
      set({ loading: false, error: error instanceof Error ? error.message : 'Unknown error' })
    }
  },
  
  // Computed getters
  getFilteredComments: () => {
    const state = get()
    let filtered = [...state.comments]
    
    // Apply search
    if (state.filters.searchQuery) {
      const query = state.filters.searchQuery.toLowerCase()
      filtered = filtered.filter(c => {
        // Search in structured sections
        const searchInSections = c.structuredSections ? (
          c.structuredSections.oneLineSummary?.toLowerCase().includes(query) ||
          c.structuredSections.corePosition?.toLowerCase().includes(query) ||
          c.structuredSections.detailedContent?.toLowerCase().includes(query)
        ) : false
        
        return searchInSections ||
          c.submitter?.toLowerCase().includes(query) ||
          c.id?.toLowerCase().includes(query)
      })
    }
    
    // Apply theme filters
    if (state.filters.themes.length > 0) {
      filtered = filtered.filter(c => {
        if (!c.themeScores) return false
        return state.filters.themes.some((themeCode: string) => 
          c.themeScores![themeCode] && c.themeScores![themeCode] <= 2
        )
      })
    }
    
    // Apply entity filters
    if (state.filters.entities.length > 0) {
      filtered = filtered.filter(c => {
        if (!c.entities || c.entities.length === 0) return false
        return state.filters.entities.some((entityKey: string) => {
          const [category, label] = entityKey.split('|')
          return c.entities!.some(e => e.category === category && e.label === label)
        })
      })
    }
    
    // Apply submitter type filters
    if (state.filters.submitterTypes.length > 0) {
      filtered = filtered.filter(c => 
        state.filters.submitterTypes.includes(c.submitterType)
      )
    }
    
    // Apply condensed filter (now checks for structured sections)
    if (state.filters.hasCondensed !== 'all') {
      filtered = filtered.filter(c => 
        state.filters.hasCondensed === 'yes' ? c.structuredSections : !c.structuredSections
      )
    }
    
    return filtered
  },
  
  getCommentsForTheme: (themeCode: string) => {
    const state = get()
    const commentIds = state.themeIndex[themeCode]
    if (!commentIds) return { direct: [], touches: [] }
    
    const findComment = (id: string): Comment | undefined => 
      state.comments.find(c => c.id === id)
    
    return {
      direct: (commentIds.direct || [])
        .map(findComment)
        .filter((c): c is Comment => c !== undefined),
      touches: (commentIds.touches || [])
        .map(findComment)
        .filter((c): c is Comment => c !== undefined)
    }
  },
  
  getCommentsForEntity: (category: string, label: string) => {
    const state = get()
    const key = `${category}|${label}`
    const commentIds = state.entityIndex[key] || []
    
    return commentIds
      .map(id => state.comments.find(c => c.id === id))
      .filter((c): c is Comment => c !== undefined)
  }
}))

export default useStore 

// Helper function to determine organization category
function determineOrganizationCategory(
  themeSummaries: Record<string, ThemeSummary>, 
  entities: Record<string, Entity[]>
): string | null {
  // Collect a sample of organizations from theme summaries
  const organizationSample = new Set<string>()
  const maxSample = 200
  
  for (const summary of Object.values(themeSummaries)) {
    if (organizationSample.size >= maxSample) break
    
    const { sections } = summary
    
    // Extract from consensus points
    if (sections.consensusPoints) {
      for (const point of sections.consensusPoints) {
        if (point.organizations) {
          point.organizations.forEach((org: string) => organizationSample.add(org))
        }
      }
    }
    
    // Extract from areas of debate
    if (sections.areasOfDebate) {
      for (const debate of sections.areasOfDebate) {
        if (debate.positions) {
          for (const position of debate.positions) {
            if (position.organizations) {
              position.organizations.forEach((org: string) => organizationSample.add(org))
            }
          }
        }
      }
    }
    
    // Extract from stakeholder perspectives
    if (sections.stakeholderPerspectives) {
      for (const stakeholder of sections.stakeholderPerspectives) {
        if (stakeholder.organizations) {
          stakeholder.organizations.forEach((org: string) => organizationSample.add(org))
        }
      }
    }
  }
  
  // Now check which category has the most matches
  const categoryMatches: Record<string, number> = {}
  
  for (const [category, entityList] of Object.entries(entities)) {
    let matchCount = 0
    for (const entity of entityList) {
      for (const term of entity.terms) {
        if (organizationSample.has(term)) {
          matchCount++
          break // Count each entity only once
        }
      }
    }
    if (matchCount > 0) {
      categoryMatches[category] = matchCount
    }
  }
  
  // Find the category with most matches
  let bestCategory: string | null = null
  let maxMatches = 0
  
  for (const [category, count] of Object.entries(categoryMatches)) {
    if (count > maxMatches) {
      maxMatches = count
      bestCategory = category
    }
  }
  
  // Default fallback
  return bestCategory || 'Organizations'
} 