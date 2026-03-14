#!/bin/bash

# Babaclick FBM Operations Hub - Setup Script

echo "🚀 Babaclick FBM Operations Hub Setup"
echo "======================================"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js 18+"
    exit 1
fi

echo "✅ Node.js $(node --version) found"

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm not found"
    exit 1
fi

echo "✅ npm $(npm --version) found"

# Install root dependencies
echo ""
echo "📦 Installing root dependencies..."
npm install

# Install server dependencies
echo ""
echo "📦 Installing server dependencies..."
cd server
npm install
cd ..

# Install client dependencies
echo ""
echo "📦 Installing client dependencies..."
cd client
npm install
cd ..

# Create .env if it doesn't exist
if [ ! -f .env ]; then
    echo ""
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo "⚠️  Please edit .env with your credentials:"
    echo "   - Gmail app password"
    echo "   - MongoDB URI"
    echo "   - Google Sheets API key"
    echo "   - Google Sheets ID"
    echo "   - JWT secret"
    echo "   - Admin email"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "📚 Next steps:"
echo "1. Edit .env with your credentials"
echo "2. Run: npm run dev"
echo "3. Open http://localhost:3000"
echo ""
echo "For detailed setup instructions, see DEPLOYMENT.md"
