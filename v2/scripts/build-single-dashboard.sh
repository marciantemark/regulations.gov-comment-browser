#!/bin/bash

# Script to build dashboard for a single regulation

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check for regulation ID argument
if [ -z "$1" ]; then
  echo -e "${RED}Error: Please provide a regulation ID${NC}"
  echo "Usage: $0 <regulation-id>"
  echo "Example: $0 CMS-2025-0050-0031"
  exit 1
fi

REGULATION_ID="$1"
DB_FILE="dbs/${REGULATION_ID}.sqlite"

# Check if database exists
if [ ! -f "$DB_FILE" ]; then
  echo -e "${RED}Error: Database file not found: $DB_FILE${NC}"
  echo "Available databases:"
  for db in dbs/*.sqlite; do
    [ -e "$db" ] || continue
    if [[ "$db" != *.sqlite-* ]] && [[ "$db" != *.sqlite.sqlite ]]; then
      echo "  - $(basename "$db" .sqlite)"
    fi
  done
  exit 1
fi

echo -e "${BLUE}🏗️  Building dashboard for ${REGULATION_ID}...${NC}"

# Create dist directory
mkdir -p "dist/${REGULATION_ID}"

# Generate data files for this regulation
echo "  - Generating data files..."
bun run src/cli.ts build-website "$REGULATION_ID" --output "temp-data"

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
echo "  - Copying to dist/${REGULATION_ID}..."
cp -r dashboard/dist/* "dist/${REGULATION_ID}/"

# Clean up temp data
rm -rf temp-data

echo -e "${GREEN}✅ Dashboard built successfully!${NC}"
echo -e "${GREEN}📂 Output directory: dist/${REGULATION_ID}${NC}"
echo -e "${GREEN}🌐 To serve locally, run: cd dist/${REGULATION_ID} && python -m http.server 8000${NC}" 