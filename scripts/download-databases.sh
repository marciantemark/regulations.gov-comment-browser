#!/bin/bash

# Script to download SQLite databases from Google Drive

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}📥 Downloading SQLite databases from Google Drive...${NC}"

# Remove existing dbs directory if it exists
rm -rf dbs

# Try to download the entire folder
if command -v gdown &> /dev/null; then
    echo -e "${BLUE}Attempting to download entire folder...${NC}"
    gdown --folder "https://drive.google.com/drive/folders/1XBm4lp-ZPZs59I_OJSe8gg1sYRPFpzp_" --remaining-ok || {
        echo -e "${RED}Folder download failed.${NC}"
        exit 1
    }
    
    # gdown creates a subdirectory called "regulations-dbs", just rename it to "dbs"
    if [ -d "regulations-dbs" ]; then
        echo -e "${BLUE}Renaming regulations-dbs to dbs...${NC}"
        mv regulations-dbs dbs
    else
        echo -e "${RED}Expected folder 'regulations-dbs' not found after download${NC}"
        exit 1
    fi
else
    echo -e "${RED}gdown is not installed. Please install it with: pip install gdown${NC}"
    exit 1
fi

# Remove any non-SQLite files
cd dbs
find . -type f ! -name "*.sqlite" ! -name "*.sqlite-shm" ! -name "*.sqlite-wal" -delete 2>/dev/null || true
cd ..

# List downloaded files
echo -e "\n${GREEN}✅ Downloaded databases:${NC}"
ls -lh dbs/*.sqlite 2>/dev/null || echo -e "${RED}No SQLite files found${NC}"

echo -e "\n${GREEN}✅ Database download complete${NC}" 