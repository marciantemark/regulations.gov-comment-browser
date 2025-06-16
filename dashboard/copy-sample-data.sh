#!/bin/bash

# Create public/data directory if it doesn't exist
mkdir -p public/data/indexes

# Copy data from the parent project's dist/data directory
if [ -d "../dist/data" ]; then
  echo "Copying data from ../dist/data..."
  cp -r ../dist/data/* public/data/
  echo "✅ Data copied successfully!"
else
  echo "❌ Error: ../dist/data not found. Please run 'bun run build-website <document-id>' in the parent directory first."
  exit 1
fi 