#!/usr/bin/env python3
import csv
import psycopg2
import sys

def import_csv_to_db():
    try:
        # Connect to PostgreSQL
        conn = psycopg2.connect(
            dbname="fbm_hub_dev",
            user="ops",
            password="26@December*o4",
            host="localhost",
            port=5432
        )
        conn.autocommit = True
        cursor = conn.cursor()
        
        imported = 0
        skipped = 0
        skip_reasons = {}
        error_log = []
        
        print("📂 Reading CSV file...")
        with open('/Users/parthsharma/Desktop/babaclick/import-data.csv', 'r') as f:
            reader = csv.reader(f)
            # Skip first header row (category headers)
            header1 = next(reader, None)
            # Get second header row (actual column names)
            header2 = next(reader, None)
            print(f"📋 Column Header: {header2}")
            
            for idx, row in enumerate(reader, start=3):
                try:
                    if not row or not row[0]:
                        continue
                    
                    # Safely handle date fields (convert "-" or empty to None)
                    def safe_date(val):
                        if not val or str(val).strip() == '-' or str(val).strip() == '':
                            return None
                        
                        val_str = str(val).strip()
                        import re
                        
                        # ONLY accept these formats:
                        # 1. YYYY-MM-DD (with optional time)
                        # 2. M/D/YYYY or MM/DD/YYYY
                        
                        # Format 1: 2025-01-15 or 2025-01-15 10:30:00
                        if re.match(r'^\d{4}-\d{2}-\d{2}', val_str):
                            # Make sure it's not too long (no extra junk)
                            if len(val_str) <= 30:
                                return val_str
                        
                        # Format 2: 1/15/2025 or 01/15/2025
                        if re.match(r'^\d{1,2}/\d{1,2}/\d{4}(\s|:|$)', val_str):
                            # Extract just the date part, reject anything with ranges
                            if '-' not in val_str.split()[0]:  # No '-' in date portion
                                return val_str
                        
                        # Reject EVERYTHING else (ranges, text labels, dots, month names, etc)
                        return None
                    
                    def safe_float(val):
                        if not val or val.strip() == '-' or val.strip() == '':
                            return 0
                        try:
                            return float(val)
                        except:
                            return 0
                    
                    def safe_int(val, default=1):
                        if not val or val.strip() == '-' or val.strip() == '':
                            return default
                        try:
                            return int(float(val))
                        except:
                            return default
                    
                    sql = """
                        INSERT INTO orders 
                        (order_id, sku, qty, product_name, order_date, delivery_date, 
                         ship_by_date, buy_link, po_id, total_sell_price, status, imported_by)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """
                    
                    # Only require order_id to be non-empty
                    order_id = str(row[2]).strip() if len(row) > 2 else None
                    if not order_id or order_id.startswith('='):  # Skip formula cells
                        skipped += 1
                        continue
                    
                    values = (
                        order_id,  # order_id
                        str(row[5]).strip() if len(row) > 5 and row[5] and not str(row[5]).startswith('=') else None,  # sku - skip formulas
                        safe_int(row[6]) if len(row) > 6 else 1,  # qty
                        str(row[7]).strip() if len(row) > 7 and row[7] and not str(row[7]).startswith('=') else None,  # product_name
                        safe_date(row[1]) if len(row) > 1 else None,  # order_date
                        safe_date(row[26]) if len(row) > 26 else None,  # delivery_date
                        safe_date(row[10]) if len(row) > 10 else None,  # ship_by_date
                        str(row[13]).strip() if len(row) > 13 and row[13] and not str(row[13]).startswith('=') else None,  # buy_link
                        str(row[14]).strip() if len(row) > 14 and row[14] and not str(row[14]).startswith('=') else None,  # po_id
                        safe_float(row[9]) if len(row) > 9 else 0,  # total_sell_price
                        'pending',
                        'import@babaclick.com'
                    )
                    
                    cursor.execute(sql, values)
                    # Check if row was actually inserted (rowcount > 0)
                    if cursor.rowcount > 0:
                        imported += 1
                    else:
                        skipped += 1  # Duplicate key, silently ignored
                    
                    if imported % 100 == 0:
                        print(f"  ✓ {imported} rows inserted successfully...")
                    
                except Exception as e:
                    skipped += 1
                    error_msg = str(e)
                    reason = "Other error"
                    
                    if 'unique' in error_msg.lower() or 'duplicate' in error_msg.lower():
                        reason = "Duplicate key"
                    elif 'not-null' in error_msg.lower() or 'null' in error_msg.lower():
                        reason = "NULL constraint"
                    elif 'value' in error_msg.lower():
                        reason = "Invalid value"
                    elif 'check' in error_msg.lower():
                        reason = "CHECK constraint"
                    
                    skip_reasons[reason] = skip_reasons.get(reason, 0) + 1
                    error_log.append(f"Row {idx}: {reason}\n  Error: {error_msg}\n")
                    if skipped <= 10:
                        short_msg = error_msg[:100] if len(error_msg) > 100 else error_msg
                        print(f"  ⚠️ Row {idx}: {reason}")
        
        cursor.close()
        conn.close()
        
        print(f"\n✅ IMPORT COMPLETE!")
        print(f"   ✓ {imported} orders imported to database")
        print(f"   ⏭️  {skipped} rows skipped")
        if skip_reasons:
            print(f"\n📊 Skip reasons:")
            for reason, count in sorted(skip_reasons.items(), key=lambda x: x[1], reverse=True):
                print(f"   • {reason}: {count}")
        
        # Save error log to file
        if error_log:
            with open('/Users/parthsharma/Desktop/babaclick/import_errors.log', 'w') as f:
                for err in error_log:
                    f.write(err)
        
    except Exception as e:
        print(f"❌ ERROR: {e}")
        sys.exit(1)

if __name__ == "__main__":
    import_csv_to_db()
