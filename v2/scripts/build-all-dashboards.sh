#!/bin/bash

# Script to build separate dashboard instances for each regulation database

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🏗️  Building dashboards for all regulations...${NC}"

# Create dist directory
mkdir -p dist

# Find all SQLite databases (excluding WAL and SHM files)
for db_file in dbs/*.sqlite; do
  # Skip if no files found
  [ -e "$db_file" ] || continue
  
  # Skip WAL and SHM related files
  if [[ "$db_file" == *.sqlite-* ]] || [[ "$db_file" == *.sqlite.sqlite ]]; then
    continue
  fi
  
  # Extract regulation ID from filename
  regulation_id=$(basename "$db_file" .sqlite)
  
  echo -e "\n${BLUE}📊 Building dashboard for ${regulation_id}...${NC}"
  
  # Generate data files for this regulation
  echo "  - Generating data files..."
  bun run src/cli.ts build-website "$regulation_id" --output "temp-data"
  
  # Copy data to dashboard public directory
  echo "  - Copying data to dashboard..."
  rm -rf dashboard/public/data
  cp -r temp-data dashboard/public/data
  
  # Build the dashboard
  echo "  - Building React app..."
  cd dashboard
  bun run build
  cd ..
  
  # Copy built dashboard to dist directory
  echo "  - Copying to dist/$regulation_id..."
  mkdir -p "dist/$regulation_id"
  cp -r dashboard/dist/* "dist/$regulation_id/"
  
  # Clean up temp data
  rm -rf temp-data
  
  echo -e "${GREEN}✅ Completed build for ${regulation_id}${NC}"
done

# Create an index.html at the root to list all regulations
echo -e "\n${BLUE}📝 Creating index page...${NC}"
cat > dist/index.html << 'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Regulation Comment Dashboards</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 2rem;
      background-color: #f5f5f5;
    }
    h1 {
      color: #333;
      margin-bottom: 2rem;
    }
    .regulation-list {
      background: white;
      border-radius: 8px;
      padding: 1.5rem;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .regulation-item {
      display: block;
      padding: 1rem;
      margin: 0.5rem 0;
      background: #f8f9fa;
      border-radius: 4px;
      text-decoration: none;
      color: #0066cc;
      transition: background-color 0.2s;
    }
    .regulation-item:hover {
      background: #e9ecef;
    }
    .regulation-id {
      font-weight: 600;
      font-size: 1.1rem;
    }
    .regulation-date {
      color: #666;
      font-size: 0.9rem;
      margin-top: 0.25rem;
    }
  </style>
</head>
<body>
  <h1>Regulation Comment Dashboards</h1>
  <div class="regulation-list">
    <h2>Available Dashboards</h2>
EOF

# Add links to each regulation dashboard
for db_file in dbs/*.sqlite; do
  [ -e "$db_file" ] || continue
  if [[ "$db_file" == *.sqlite-* ]] || [[ "$db_file" == *.sqlite.sqlite ]]; then
    continue
  fi
  
  regulation_id=$(basename "$db_file" .sqlite)
  echo "    <a href=\"./$regulation_id/\" class=\"regulation-item\">" >> dist/index.html
  echo "      <div class=\"regulation-id\">$regulation_id</div>" >> dist/index.html
  echo "      <div class=\"regulation-date\">View Dashboard →</div>" >> dist/index.html
  echo "    </a>" >> dist/index.html
done

cat >> dist/index.html << 'EOF'
  </div>
</body>
</html>
EOF

echo -e "\n${GREEN}✅ All dashboards built successfully!${NC}"
echo -e "${GREEN}📂 Output directory: dist/${NC}"
echo -e "${GREEN}🌐 To serve locally, run: cd dist && python -m http.server 8000${NC}" 