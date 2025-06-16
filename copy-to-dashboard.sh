#!/bin/bash

# Script to copy generated website files to dashboard

if [ -z "$1" ]; then
  echo "Usage: ./copy-to-dashboard.sh <source-dir>"
  echo "Example: ./copy-to-dashboard.sh dist/data"
  exit 1
fi

SOURCE_DIR="$1"
DEST_DIR="dashboard/public/data"

if [ ! -d "$SOURCE_DIR" ]; then
  echo "Error: Source directory '$SOURCE_DIR' does not exist"
  exit 1
fi

echo "📁 Copying files from $SOURCE_DIR to $DEST_DIR..."

# Create destination directory if it doesn't exist
mkdir -p "$DEST_DIR"

# Copy all files
cp -r "$SOURCE_DIR"/* "$DEST_DIR/"

echo "✅ Files copied successfully!"
echo "🚀 You can now run 'cd dashboard && bun run dev' to start the dashboard" 