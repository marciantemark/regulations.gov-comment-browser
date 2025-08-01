# Comment Analysis Dashboard

A TypeScript React application for browsing and analyzing public comments from regulations.gov.

## Features

- **Theme-Centric Navigation**: Browse hierarchical themes with expand/collapse functionality
- **Smart Comment Filtering**: Filter by themes, entities, stakeholder types
- **Markdown Rendering**: Condensed comments are displayed with proper markdown formatting
- **Hash-Based Routing**: All views are bookmarkable URLs (e.g., `#/themes/1.2.3`)
- **Export Capabilities**: Export filtered comments to CSV
- **Entity Browser**: Explore entities by category with mention counts
- **Responsive Design**: Works on desktop and mobile devices

## Development

```bash
# Install dependencies
bun install

# Start development server
bun run dev

# Build for production
bun run build

# Preview production build
bun run preview
```

## Data Requirements

The dashboard expects the following JSON files in `/public/data/`:

- `meta.json` - Document metadata and statistics
- `themes.json` - Theme hierarchy with quotes
- `entities.json` - Entity taxonomy by category
- `comments.json` - All comments with condensed text
- `indexes/theme-comments.json` - Theme to comment mapping
- `indexes/entity-comments.json` - Entity to comment mapping

Generate these files using the main CLI tool:
```bash
bun run build-website <document-id>
```

## URL Structure

- `#/overview` - Dashboard overview with statistics
- `#/themes` - Theme hierarchy browser
- `#/themes/:code` - Individual theme detail with comments
- `#/entities` - Entity browser by category
- `#/entities/:category/:label` - Entity detail with mentions
- `#/comments` - Comment browser with filters
- `#/comments/:id` - Individual comment detail

## Technology Stack

- **React 18** with TypeScript
- **React Router** for hash-based routing
- **Zustand** for state management
- **Tailwind CSS** for styling
- **React Markdown** for rendering condensed text
- **Vite** for fast builds with Bun 