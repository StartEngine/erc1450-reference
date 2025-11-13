#!/bin/bash

# Release script for startengine-erc1450 package
# Manages versioning and git tags

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get current version from __init__.py
CURRENT_VERSION=$(grep __version__ startengine_erc1450/__init__.py | sed 's/.*"\(.*\)".*/\1/')

echo -e "${GREEN}Current version: ${CURRENT_VERSION}${NC}"
echo ""
echo "What kind of release is this?"
echo "1) Patch (bug fixes)     - Will bump to $(echo $CURRENT_VERSION | awk -F. '{print $1"."$2"."$3+1}')"
echo "2) Minor (new features)  - Will bump to $(echo $CURRENT_VERSION | awk -F. '{print $1"."$2+1".0"}')"
echo "3) Major (breaking)      - Will bump to $(echo $CURRENT_VERSION | awk -F. '{print $1+1".0.0"}')"
echo "4) Custom version"
echo "5) Cancel"
echo ""
read -p "Select (1-5): " choice

case $choice in
    1)
        NEW_VERSION=$(echo $CURRENT_VERSION | awk -F. '{print $1"."$2"."$3+1}')
        ;;
    2)
        NEW_VERSION=$(echo $CURRENT_VERSION | awk -F. '{print $1"."$2+1".0"}')
        ;;
    3)
        NEW_VERSION=$(echo $CURRENT_VERSION | awk -F. '{print $1+1".0.0"}')
        ;;
    4)
        read -p "Enter new version (e.g., 1.2.3): " NEW_VERSION
        ;;
    5)
        echo -e "${YELLOW}Release cancelled${NC}"
        exit 0
        ;;
    *)
        echo -e "${RED}Invalid choice${NC}"
        exit 1
        ;;
esac

echo ""
echo -e "${GREEN}New version will be: ${NEW_VERSION}${NC}"
read -p "Continue? (y/n): " confirm

if [ "$confirm" != "y" ]; then
    echo -e "${YELLOW}Release cancelled${NC}"
    exit 0
fi

# Validate that loader.py is up to date
echo ""
echo "Validating loader.py is up to date..."
python scripts/update_loader.py

# Check if there are changes
if git diff --quiet startengine_erc1450/artifacts/loader.py; then
    echo -e "${GREEN}✓ loader.py is up to date${NC}"
else
    echo -e "${YELLOW}⚠ loader.py had outdated CONTRACT_PATHS${NC}"
    echo -e "${YELLOW}  Auto-updated. Changes will be included in release.${NC}"
fi
echo ""

# Update version in __init__.py
sed -i "" "s/__version__ = \".*\"/__version__ = \"$NEW_VERSION\"/" startengine_erc1450/__init__.py

# Update version in setup.py comment
sed -i "" "s/# $CURRENT_VERSION -/# $NEW_VERSION -/" setup.py

# Stage changes (including loader.py if it was updated)
git add startengine_erc1450/__init__.py setup.py startengine_erc1450/artifacts/loader.py

# Commit
git commit -m "Bump version to $NEW_VERSION"

# Create tag
git tag -a "v$NEW_VERSION" -m "Release version $NEW_VERSION"

echo ""
echo -e "${GREEN}✓ Version bumped to $NEW_VERSION${NC}"
echo -e "${GREEN}✓ Changes committed${NC}"
echo -e "${GREEN}✓ Tag v$NEW_VERSION created${NC}"
echo ""
echo "To push the release:"
echo "  git push origin main"
echo "  git push origin v$NEW_VERSION"
echo ""
echo "Users can then install with:"
echo "  pip install git+https://github.com/StartEngine/erc1450-reference.git@v$NEW_VERSION"