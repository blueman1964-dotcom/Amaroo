import pdfplumber
import json
import re
import sys

# Port pages (1-indexed): Gold Coast 6-8, Brisbane Bar 9-11, Mooloolaba 12-14, 
# Noosa Head 15-17, Waddy Point 18-20, Urangan 21-23, Bundaberg 24-26
PORTS = [
    ('gold_coast_seaway', 'Gold Coast Seaway', -27.933, 153.417, [6, 7, 8]),
    ('brisbane_bar', 'Brisbane Bar', -27.367, 153.167, [9, 10, 11]),
    ('mooloolaba', 'Mooloolaba', -26.683, 153.117, [12, 13, 14]),
    ('noosa_head', 'Noosa Head', -26.383, 153.100, [15, 16, 17]),
    ('waddy_point', 'Waddy Point (K\'gari)', -24.967, 153.350, [18, 19, 20]),
    ('urangan', 'Urangan', -25.300, 152.917, [21, 22, 23]),
    ('bundaberg', 'Bundaberg (Burnett Heads)', -24.767, 152.383, [24, 25, 26]),
]

MONTH_NAMES = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE',
               'JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER']
MONTH_DAYS = [31,28,31,30,31,30,31,31,30,31,30,31]  # 2026 is not a leap year

def time_to_str(t):
    """Convert HHMM string to HH:MM"""
    t = t.zfill(4)
    return f"{t[:2]}:{t[2:]}"

def parse_tide_page(text):
    """Parse a tide table page and return list of (day, month, tides) where tides = [(time_str, height)]"""
    lines = text.split('\n')
    # Find months on this page
    month_line = None
    for line in lines:
        for m in MONTH_NAMES:
            if m in line.upper():
                month_line = line
                break
        if month_line:
            break
    
    # Find which months appear and in what order
    months_on_page = []
    for i, m in enumerate(MONTH_NAMES):
        if m in text.upper():
            months_on_page.append((i+1, m))
    
    if not months_on_page:
        return []
    
    # Each page has 4 months in 4 column pairs
    # The data rows look like: "1 16 1 16 1 16 1 16" (day numbers) then
    # time height pairs for each day column
    # 
    # Format: day numbers appear as "N" (1-15 left, 16-31 right) 
    # Then tide entries follow with "HHMM height" pattern
    # Day prefix like "TH", "FR", "SA" etc appears before times
    
    events = []  # (month, day, time_str, height)
    
    # Better approach: find all lines matching tide data pattern
    # Tidal data line pattern: optional day-of-week prefix, then HHMM space height
    # e.g. "0615 1.76", "TH1829 1.14", "SU 1428 0.21"
    
    # Parse by looking for the structure more carefully
    # Each page = 4 months, split into 2 halves: days 1-15 (left) and 16-31 (right)
    # They're presented as 8 columns total
    
    return parse_structured(text, months_on_page)

def parse_structured(text, months_on_page):
    """Parse structured tide table using column-aware parsing"""
    lines = [l for l in text.split('\n') if l.strip()]
    
    # Find header line with month names
    month_order = []
    for i, line in enumerate(lines):
        found = []
        for mi, m in enumerate(MONTH_NAMES):
            if m in line.upper():
                found.append((line.upper().index(m), mi+1))
        if len(found) >= 2:
            found.sort()
            month_order = [f[1] for f in found]
            break
    
    if not month_order:
        month_order = [m[0] for m in months_on_page[:4]]
    
    # Now parse day entries
    # Look for lines starting with a day number pattern
    # Day lines look like: "1 16 1 16 1 16 1 16" spacing then tides below
    # Actually data comes in groups: day header row (like "1 16 1 16 1 16 1 16")
    # followed by tide rows (HHMM height repeated 8 times across)
    
    # Let me try a different approach: find all (time, height) pairs by scanning
    # through the raw text and correlating with day markers
    
    events = []
    
    # Parse line by line looking for day-start patterns
    # A "day block" starts when we see a line with the pattern:
    # (optional 2-letter day)(4-digit time)(space)(decimal height)
    
    # Actually let's parse more carefully column by column
    # The page has 8 columns: months M1,M2,M3,M4 each split days 1-15/16-31
    # So columns are: M1_left, M1_right, M2_left, M2_right, M3_left, M3_right, M4_left, M4_right
    # For row day d (1-15): col0=M1[d], col1=M1[d+15], col2=M2[d], col3=M2[d+15], ...
    
    # Find "Time m" header lines to get column positions
    # Then read each subsequent row
    
    # Simplified: use regex to find all time-height pairs and associate with days
    # Pattern: optional [A-Z]{2}\s? then 4 digits, space, decimal number
    
    # Let's find all data rows more precisely
    # Key insight: rows start with optional day abbreviation followed by tide data
    # Also the day number line comes before the tides for that batch of days
    
    return parse_column_based(text, month_order)

def parse_column_based(text, month_order):
    """Column-based parser for the tide table format"""
    lines = text.split('\n')
    
    events = []
    
    # A page has days 1-31. The table presents day d in row d (for d=1..15 in left set, 16..31 in right set)
    # But they're interleaved: column 0=month1[d], col1=month1[d+15], col2=month2[d], col3=month2[d+15]...
    # Let's track current "row group" which corresponds to a day index (1-15)
    
    # Find data lines: lines that contain tide time-height pairs
    # Format: [DAYABBREV]HHMM H.HH or DAYABBREV HHMM H.HH
    TIME_HEIGHT = re.compile(r'(?:[A-Z]{2}\s?)(\d{4})\s+(\d+\.\d+)')
    TIME_HEIGHT2 = re.compile(r'([A-Z]{2})\s*(\d{4})\s+(\d+\.\d+)')
    
    # Actually let me look at the raw page text more carefully
    # Let me output first 50 lines of a page to understand structure
    print("DEBUG first 30 lines of page:")
    for i, l in enumerate(lines[:30]):
        print(f"  {i}: {repr(l)}")
    
    return []

# Run debug
with pdfplumber.open(r'C:\Users\stuar\Amaroo\2026_queenslandtidetables.pdf') as pdf:
    # Get page 6 (Gold Coast Jan-Apr)
    page = pdf.pages[5]  # 0-indexed
    text = page.extract_text()
    if text:
        lines = text.split('\n')
        print(f"Total lines: {len(lines)}")
        for i, l in enumerate(lines):
            print(f"{i:3}: {repr(l)}")
    else:
        print("No text extracted")
