#!/bin/bash
cd /Users/parthsharma/Desktop/babaclick

# Clear database
python3 << 'EOFPYTHON'
import psycopg2
conn = psycopg2.connect(dbname="fbm_hub_dev", user="ops", password="26@December*o4", host="localhost", port=5432)
cursor = conn.cursor()
cursor.execute("DELETE FROM orders;")
conn.commit()
cursor.close()
conn.close()
EOFPYTHON

echo "✅ Database cleared"

# Run import
python3 import_excel.py
