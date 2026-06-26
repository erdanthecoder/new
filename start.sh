#!/bin/bash

echo ""
echo " =========================================="
echo "   KidWorld - Starting up..."
echo " =========================================="
echo ""

# Check Python
if ! command -v python3 &> /dev/null; then
    echo " ERROR: Python 3 is not installed!"
    echo ""
    echo " Mac:   brew install python3"
    echo " Linux: sudo apt install python3 python3-pip"
    echo ""
    exit 1
fi

# Install Flask
echo " Installing requirements..."
pip3 install flask --quiet

echo ""
echo " Starting KidWorld..."
echo " Opening http://localhost:5000"
echo ""

# Open browser after 2 seconds (Mac and Linux)
(sleep 2 && (open http://localhost:5000 2>/dev/null || xdg-open http://localhost:5000 2>/dev/null)) &

# Start server
python3 server.py
