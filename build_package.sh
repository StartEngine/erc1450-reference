#!/bin/bash

# Build script for startengine-erc1450 package
# This script prepares the package for distribution by copying artifacts

set -e

echo "Building startengine-erc1450 package..."

# Update loader.py with current contracts
echo "Updating loader.py CONTRACT_PATHS..."
python scripts/update_loader.py

# Create data directory structure in package
echo "Creating package data directory..."
mkdir -p startengine_erc1450/data/artifacts

# Copy contract artifacts to package
echo "Copying contract artifacts..."
cp -r artifacts/contracts/* startengine_erc1450/data/artifacts/

# Clean up any unwanted files
echo "Cleaning up..."
find startengine_erc1450 -name "*.pyc" -delete
find startengine_erc1450 -name "__pycache__" -type d -delete
find startengine_erc1450 -name ".DS_Store" -delete

# Build the package
echo "Building distribution packages..."
python -m pip install --upgrade build
python -m build

echo "Package built successfully!"
echo ""
echo "To install locally for testing:"
echo "  pip install -e ."
echo ""
echo "To install from GitHub (after pushing):"
echo "  pip install git+https://github.com/StartEngine/erc1450-reference.git@v1.0.0"
echo ""
echo "To tag a release:"
echo "  git tag v1.0.0"
echo "  git push origin v1.0.0"