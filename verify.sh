#!/bin/bash

# Installation and Setup Verification Script
# This script verifies all components are properly installed

echo "🔍 Babaclick FBM Operations Hub - Installation Verification"
echo "============================================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check Node.js
echo "Checking Node.js..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo -e "${GREEN}✅${NC} Node.js ${NODE_VERSION} found"
else
    echo -e "${RED}❌${NC} Node.js not found"
    exit 1
fi

# Check npm
echo "Checking npm..."
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm --version)
    echo -e "${GREEN}✅${NC} npm ${NPM_VERSION} found"
else
    echo -e "${RED}❌${NC} npm not found"
    exit 1
fi

# Check directory structure
echo ""
echo "Checking project structure..."

DIRS=("server" "client" "server/models" "server/routes" "server/controllers" "server/middleware" "server/utils" "client/src" "client/public")

for dir in "${DIRS[@]}"; do
    if [ -d "$dir" ]; then
        echo -e "${GREEN}✅${NC} $dir/"
    else
        echo -e "${RED}❌${NC} $dir/ NOT FOUND"
    fi
done

# Check key files
echo ""
echo "Checking key files..."

FILES=(
    "server/index.js"
    "server/package.json"
    "server/models/User.js"
    "client/package.json"
    "client/src/App.jsx"
    "README.md"
    "DEPLOYMENT.md"
    "QUICK_START.md"
    ".env.example"
)

for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        echo -e "${GREEN}✅${NC} $file"
    else
        echo -e "${RED}❌${NC} $file NOT FOUND"
    fi
done

# Check dependencies
echo ""
echo "Checking dependencies..."

echo -n "Root dependencies: "
if [ -d "node_modules" ]; then
    echo -e "${GREEN}✅${NC} Installed"
else
    echo -e "${YELLOW}⚠️${NC} Not installed (run: npm install)"
fi

echo -n "Server dependencies: "
if [ -d "server/node_modules" ]; then
    echo -e "${GREEN}✅${NC} Installed"
else
    echo -e "${YELLOW}⚠️${NC} Not installed (run: npm install --prefix server)"
fi

echo -n "Client dependencies: "
if [ -d "client/node_modules" ]; then
    echo -e "${GREEN}✅${NC} Installed"
else
    echo -e "${YELLOW}⚠️${NC} Not installed (run: npm install --prefix client)"
fi

# Check .env file
echo ""
echo "Checking environment configuration..."

if [ -f ".env" ]; then
    echo -e "${GREEN}✅${NC} .env file exists"
    
    # Check for key variables
    VARS=("MONGODB_URI" "JWT_SECRET" "EMAIL_USER" "GOOGLE_SHEETS_ID")
    
    for var in "${VARS[@]}"; do
        if grep -q "^$var=" .env; then
            VALUE=$(grep "^$var=" .env | cut -d'=' -f2- | cut -c1-20)
            echo "   ${GREEN}✅${NC} $var is set"
        else
            echo "   ${YELLOW}⚠️${NC} $var not configured"
        fi
    done
else
    echo -e "${YELLOW}⚠️${NC} .env file not found"
    echo "   Create one with: cp .env.example .env"
fi

# Summary
echo ""
echo "============================================================"
echo -e "${GREEN}✅ Installation verification complete!${NC}"
echo ""
echo "📝 Configuration needed in .env:"
echo "   - MONGODB_URI (MongoDB connection string)"
echo "   - JWT_SECRET (random 32+ character string)"
echo "   - EMAIL_USER (Gmail address)"
echo "   - EMAIL_PASSWORD (Gmail app password)"
echo "   - GOOGLE_SHEETS_ID (spreadsheet ID)"
echo "   - GOOGLE_SHEETS_API_KEY (Google API key)"
echo ""
echo "🚀 To start development:"
echo "   npm run dev"
echo ""
echo "📚 For detailed setup instructions:"
echo "   See QUICK_START.md"
echo ""
