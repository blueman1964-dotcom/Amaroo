"""
Parser for 2026 Queensland Tide Tables PDF.
Uses pdfplumber's positional word extraction to correctly assign tides to columns.
"""
import pdfplumber
import json
import re
import sys

# Port definitions: (id, name, lat, lng, page_indices_0based)
PORTS = [
    ('gold_coast_seaway', 'Gold Coast Seaway', -27.933, 153.417, [5, 6, 7]),
    ('brisbane_bar', 'Brisbane Bar', -27.367, 153.167, [8, 9, 10]),
    ('mooloolaba', 'Mooloolaba', -26.683, 153.117, [11, 12, 13]),
    ('noosa_head', 'Noosa Head', -26.383, 153.100, [14, 15, 16]),
    ('waddy_point', "Waddy Point (K'gari)", -24.967, 153.350, [17, 18, 19]),
    ('urangan', 'Urangan', -25.300, 152.917, [20, 21, 22]),
    ('bundaberg', 'Bundaberg (Burnett Heads)', -24.767, 152.383, [23, 24, 25]),
]

MONTH_NAMES = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE',
               'JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER']

MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]  # 2026 is not leap year

# Day 1 of 2026 is Thursday
DAY_OF_WEEK = {0: 'MO', 1: 'TU', 2: 'WE', 3: 'TH', 4: 'FR', 5: 'SA', 6: 'SU'}


def fmt_time(hhmm):
    """Convert HHMM string to HH:MM"""
    s = hhmm.zfill(4)
    return f"{s[:2]}:{s[2:]}"


def parse_tide_token(tok):
    """
    Parse a tide token which may be:
    - 'HHMM' (just time)
    - 'XYHHMM' where XY is day abbreviation (2 letters)
    - 'XY HHMM' (already split into two tokens, won't happen here since it's one word)
    Returns (time_str, has_day_marker) or None if not a valid time token
    """
    # Remove possible 2-letter day prefix
    tok = tok.strip()
    day_prefix = None
    if len(tok) >= 6 and tok[:2].isalpha():
        day_prefix = tok[:2]
        tok = tok[2:]
    
    if len(tok) == 4 and tok.isdigit():
        return fmt_time(tok), day_prefix is not None
    return None, None


def parse_port_pages(port_id, port_name, lat, lng, page_indices):
    """Parse tide data for one standard port from its pages."""
    tides = []
    
    with pdfplumber.open(r'C:\Users\stuar\Amaroo\2026_queenslandtidetables.pdf') as pdf:
        pages = [pdf.pages[i] for i in page_indices]
        
        for page_num, page in enumerate(pages):
            page_months_start = page_num * 4 + 1  # Months 1-4, 5-8, 9-12
            
            # Use positional word extraction
            words = page.extract_words(x_tolerance=3, y_tolerance=3)
            if not words:
                continue
            
            # Group words by y-coordinate (rows)
            # Round y to nearest 2 pixels to group same-line words
            rows = {}
            for w in words:
                y = round(w['top'] / 2) * 2
                if y not in rows:
                    rows[y] = []
                rows[y].append(w)
            
            # Sort rows by y
            sorted_rows = sorted(rows.items())
            
            # Find month header row (contains JANUARY, FEBRUARY etc)
            month_header_y = None
            months_in_page = []
            for y, row_words in sorted_rows:
                texts = [w['text'] for w in row_words]
                found_months = [(i+1, m) for i, m in enumerate(MONTH_NAMES) if m in texts]
                if found_months:
                    month_header_y = y
                    months_in_page = [m[0] for m in found_months]
                    # Get x positions of month headers for column detection
                    month_positions = {}
                    for w in row_words:
                        for mo_num, mo_name in enumerate(MONTH_NAMES, 1):
                            if w['text'] == mo_name:
                                month_positions[mo_num] = w['x0']
                    break
            
            if not months_in_page:
                print(f"WARNING: no months found on page {page_indices[page_num]+1}", file=sys.stderr)
                continue
            
            # Find the "Time m Time m..." header row to get column x-positions
            # Also find the "1 16 1 16..." row to understand column layout
            
            # For column assignment: each month has 2 sub-columns (left=days 1-15, right=days 16-31)
            # Total 8 columns for 4 months per page
            # Column positions approximately divide the page width into 8 sections
            
            # Find page width
            page_width = page.width
            
            # Let's find the "Time m" header row to get precise column x positions  
            time_col_xs = []
            for y, row_words in sorted_rows:
                texts = [w['text'] for w in row_words]
                if texts.count('Time') >= 4 and texts.count('m') >= 4:
                    # Extract x positions of 'Time' tokens
                    time_xs = sorted([w['x0'] for w in row_words if w['text'] == 'Time'])
                    if len(time_xs) >= 8:
                        time_col_xs = time_xs[:8]
                    elif len(time_xs) >= 4:
                        # Might be combined - 4 Time m pairs
                        time_col_xs = time_xs
                    break
            
            if not time_col_xs:
                # Fall back: estimate column positions by dividing page
                # Page margins roughly at 10% and 90%
                left_margin = page_width * 0.07
                right_margin = page_width * 0.93
                col_width = (right_margin - left_margin) / 8
                time_col_xs = [left_margin + i * col_width for i in range(8)]
            
            # Assign each x position to one of 8 columns
            # Columns: [M0_left, M0_right, M1_left, M1_right, M2_left, M2_right, M3_left, M3_right]
            # Where M0=months_in_page[0], etc.
            
            def get_col(x):
                """Get column index 0-7 for given x coordinate"""
                if not time_col_xs:
                    return 0
                # Find nearest column
                dists = [abs(x - cx) for cx in time_col_xs]
                return dists.index(min(dists))
            
            # Parse day groups
            # A day group starts with a row containing day numbers (e.g. "1 16 1 16 1 16 1 16")
            # Then followed by tide data rows until the next day group
            
            current_day_group = None  # days for each of 8 columns
            current_day_tides = {}  # col_idx -> list of (time_str, height)
            
            def flush_day_group():
                if current_day_group is None:
                    return
                for col_idx, day_num in enumerate(current_day_group):
                    if day_num is None:
                        continue
                    month_idx = col_idx // 2  # 0-3
                    if month_idx >= len(months_in_page):
                        continue
                    month = months_in_page[month_idx]
                    
                    # Build date string
                    month_num = month
                    date_str = f"2026-{month_num:02d}-{day_num:02d}"
                    
                    col_tides = current_day_tides.get(col_idx, [])
                    for (t, h) in col_tides:
                        tides.append({
                            'date': date_str,
                            'time': t,
                            '_height': h,
                        })
            
            # Process rows in order
            in_data_section = False
            
            for y, row_words in sorted_rows:
                if y == month_header_y:
                    continue
                
                texts = [w['text'] for w in row_words]
                
                # Skip header rows
                if 'Time' in texts or 'Heights' in texts or 'Waters' in texts:
                    continue
                if 'LAT' in texts[0] if texts else False:
                    continue
                if 'Times' in texts:
                    continue
                
                # Check for copyright/footer
                text_joined = ' '.join(texts)
                if 'Copyright' in text_joined or 'Datum' in text_joined or 'Moon' in text_joined:
                    continue
                
                # Check if this is a day number row (contains mostly integers 1-31)
                day_nums = []
                for t in texts:
                    try:
                        n = int(t)
                        if 1 <= n <= 31:
                            day_nums.append(n)
                        else:
                            day_nums = []
                            break
                    except ValueError:
                        day_nums = []
                        break
                
                if len(day_nums) >= 2 and all(1 <= n <= 31 for n in day_nums):
                    # Flush previous day group
                    flush_day_group()
                    current_day_tides = {}
                    in_data_section = True
                    
                    # Assign day numbers to columns by x position
                    col_days = [None] * 8
                    for w in row_words:
                        try:
                            n = int(w['text'])
                            if 1 <= n <= 31:
                                col = get_col(w['x0'])
                                col_days[col] = n
                        except ValueError:
                            pass
                    current_day_group = col_days
                    continue
                
                if not in_data_section:
                    continue
                
                # Parse tide data row
                # Each word on this row is either:
                # - HHMM (time only)
                # - DDHHMM (day prefix + time)
                # - DD HHMM (will be two words)
                # - H.HH (height)
                # - DayAbbrev (2-letter day, appears as separate word when followed by space)
                
                # Process words, building (time, height) pairs for each column
                i = 0
                row_words_sorted = sorted(row_words, key=lambda w: w['x0'])
                
                while i < len(row_words_sorted):
                    w = row_words_sorted[i]
                    txt = w['text']
                    col = get_col(w['x0'])
                    
                    # Check if this is a height (decimal number)
                    try:
                        h = float(txt)
                        # This is a height - find the corresponding time token just before it
                        # The time was be in a previous word at the same x vicinity
                        # Look back for the time
                        if col not in current_day_tides:
                            current_day_tides[col] = []
                        # Check if last item for this col is a time waiting for height
                        if current_day_tides[col] and isinstance(current_day_tides[col][-1], str):
                            t = current_day_tides[col].pop()
                            current_day_tides[col].append((t, h))
                        i += 1
                        continue
                    except ValueError:
                        pass
                    
                    # Check if time token (possibly with day prefix)
                    day_prefix = None
                    time_txt = txt
                    
                    if len(txt) >= 2 and txt[:2].isalpha() and txt[:2].isupper():
                        day_prefix = txt[:2]
                        time_txt = txt[2:]
                    
                    if len(time_txt) == 4 and time_txt.isdigit():
                        # Valid time
                        if col not in current_day_tides:
                            current_day_tides[col] = []
                        # Add as pending time (next word should be height)
                        current_day_tides[col].append(fmt_time(time_txt))
                    elif len(txt) == 2 and txt.isalpha() and txt.isupper():
                        # Standalone day abbreviation - next word is the time
                        # Skip - the time will be in the next word
                        pass
                    
                    i += 1
            
            # Flush last day group
            flush_day_group()
    
    # Sort tides by date and time
    tides.sort(key=lambda t: (t['date'], t['time']))
    
    # Determine high/low by alternating pattern (tides alternate H/L/H/L)
    # We need to determine type from heights
    tides = assign_tide_types(tides)
    
    return tides


def assign_tide_types(tides):
    """
    Assign 'high' or 'low' type to each tide.
    Uses a rolling window to determine if each tide is a local max or min.
    """
    if not tides:
        return tides
    
    # Group by date
    from collections import defaultdict
    by_date = defaultdict(list)
    for t in tides:
        by_date[t['date']].append(t)
    
    result = []
    for date in sorted(by_date.keys()):
        day_tides = by_date[date]
        n = len(day_tides)
        
        for i, tide in enumerate(day_tides):
            h = tide['_height']
            prev_h = day_tides[i-1]['_height'] if i > 0 else None
            next_h = day_tides[i+1]['_height'] if i < n-1 else None
            
            if prev_h is None and next_h is not None:
                tide_type = 'high' if h > next_h else 'low'
            elif next_h is None and prev_h is not None:
                tide_type = 'high' if h > prev_h else 'low'
            elif prev_h is not None and next_h is not None:
                if h > prev_h and h > next_h:
                    tide_type = 'high'
                elif h < prev_h and h < next_h:
                    tide_type = 'low'
                else:
                    # Ambiguous - use height threshold
                    tide_type = 'high' if h > 0.8 else 'low'
            else:
                tide_type = 'high' if h > 0.8 else 'low'
            
            result.append({
                'date': tide['date'],
                'time': tide['time'],
                'type': tide_type,
                'height': tide['_height'],
            })
    
    return result


def main():
    all_ports = {}
    
    for port_id, port_name, lat, lng, page_indices in PORTS:
        print(f"Parsing {port_name}...", file=sys.stderr)
        tides = parse_port_pages(port_id, port_name, lat, lng, page_indices)
        print(f"  Got {len(tides)} tide events", file=sys.stderr)
        
        all_ports[port_id] = {
            'name': port_name,
            'lat': lat,
            'lng': lng,
            'type': 'standard',
            'tides': tides,
        }
    
    print(json.dumps(all_ports, indent=2))


if __name__ == '__main__':
    main()
