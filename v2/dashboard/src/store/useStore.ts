import { create } from 'zustand'
import type { StoreState, Theme, Comment } from '../types'
import { parseThemeDescription } from '../utils/helpers'

const useStore = create<StoreState>((set, get) => ({
  // Core data
  meta: null,
  themes: [],
  entities: {},
  comments: [],
  themeIndex: {},
  entityIndex: {},
  
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
    hasCondensed: 'all',
    searchQuery: ''
  },
  
  // Actions
  setData: (data) => set(data),
  setSelectedView: (view) => set({ selectedView: view }),
  setSelectedTheme: (theme) => set({ selectedTheme: theme }),
  setSelectedEntity: (entity) => set({ selectedEntity: entity }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setFilters: (filters) => set({ filters }),
  
  // Load all data
  loadData: async () => {
    set({ loading: true, error: null })
    
    try {
      const [meta, themes, entities, comments, themeIndex, entityIndex] = await Promise.all([
        fetch('/data/meta.json').then(r => r.json()),
        fetch('/data/themes.json').then(r => r.json()),
        fetch('/data/entities.json').then(r => r.json()),
        fetch('/data/comments.json').then(r => r.json()),
        fetch('/data/indexes/theme-comments.json').then(r => r.json()),
        fetch('/data/indexes/entity-comments.json').then(r => r.json()),
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
      
      set({
        meta,
        themes: parsedThemes,
        entities,
        comments,
        themeIndex,
        entityIndex,
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
        return state.filters.themes.some(themeCode => 
          c.themeScores![themeCode] && c.themeScores![themeCode] <= 2
        )
      })
    }
    
    // Apply entity filters
    if (state.filters.entities.length > 0) {
      filtered = filtered.filter(c => {
        if (!c.entities || c.entities.length === 0) return false
        return state.filters.entities.some(entityKey => {
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
  
  getCommentsForTheme: (themeCode) => {
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
  
  getCommentsForEntity: (category, label) => {
    const state = get()
    const key = `${category}|${label}`
    const commentIds = state.entityIndex[key] || []
    
    return commentIds
      .map(id => state.comments.find(c => c.id === id))
      .filter((c): c is Comment => c !== undefined)
  }
}))

export default useStore 