"""
Robust parser for 2026 Queensland Tide Tables PDF.
Uses pdfplumber word positions to correctly assign tides to columns.
"""
import pdfplumber
import json
import re
import sys
from collections import defaultdict

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

def fmt_time(hhmm):
    s = hhmm.zfill(4)
    return f"{s[:2]}:{s[2:]}"

def is_height(s):
    try:
        f = float(s)
        return 0.0 <= f <= 5.0
    except:
        return False

def is_time(s):
    """Check if s looks like HHMM"""
    if len(s) == 4 and s.isdigit():
        h, m = int(s[:2]), int(s[2:])
        return 0 <= h <= 23 and 0 <= m <= 59
    return False

def parse_token(s):
    """
    Parse a token which might be:
    - 'HHMM' -> ('time', 'HH:MM')
    - 'XYHHMM' -> ('time', 'HH:MM')  (XY = 2-letter day abbrev)
    - 'X.XX' -> ('height', float)
    - '1'..'31' -> ('day', int)
    - 'MO','TU',etc -> ('dayabbrev', str)
    - else -> ('unknown', str)
    """
    s = s.strip()
    if not s:
        return ('unknown', s)
    
    # Height: decimal number
    if re.match(r'^\d+\.\d+$', s):
        v = float(s)
        if 0 <= v <= 6:
            return ('height', v)
    
    # Day number (1-31)
    if re.match(r'^\d{1,2}$', s):
        n = int(s)
        if 1 <= n <= 31:
            return ('day', n)
    
    # Time with optional day prefix
    # Could be HHMM or DAYABBREVHHMM
    if len(s) >= 4:
        # Try to find 4-digit time at end or after 2-letter prefix
        if s[:2].isalpha() and s[:2].isupper() and len(s) >= 6:
            # DAYABBREVHHMM format
            time_part = s[2:]
            if is_time(time_part):
                return ('time', fmt_time(time_part))
        if is_time(s):
            return ('time', fmt_time(s))
        if is_time(s[-4:]) and s[:-4].isalpha():
            return ('time', fmt_time(s[-4:]))
    
    # 2-letter day abbreviation (standalone)
    if len(s) == 2 and s.isalpha() and s.isupper():
        return ('dayabbrev', s)
    
    return ('unknown', s)


def find_column_centers(words, page_width):
    """Find 8 column x-centers from the 'Time m' header row."""
    # Look for rows with multiple 'Time' and 'm' words
    rows_by_y = defaultdict(list)
    for w in words:
        y = round(w['top'] / 3) * 3
        rows_by_y[y].append(w)
    
    best_row = None
    best_score = 0
    for y, row_words in rows_by_y.items():
        texts = [w['text'] for w in row_words]
        score = texts.count('Time') + texts.count('m')
        if score > best_score:
            best_score = score
            best_row = row_words
    
    if best_row:
        time_xs = sorted([w['x0'] for w in best_row if w['text'] == 'Time'])
        if len(time_xs) >= 8:
            return time_xs[:8]
        if len(time_xs) >= 4:
            # 4 "Time" headers but each month has 2 sub-columns
            # In between each pair of Time headers is another sub-column
            # Estimate sub-column positions
            col_xs = []
            for i in range(len(time_xs)):
                col_xs.append(time_xs[i])
                if i < len(time_xs) - 1:
                    mid = (time_xs[i] + time_xs[i+1]) / 2
                    col_xs.append(mid)
            return col_xs[:8]
    
    # Fallback: uniform division
    margin_l = page_width * 0.07
    margin_r = page_width * 0.95
    col_width = (margin_r - margin_l) / 8
    return [margin_l + i * col_width for i in range(8)]


def assign_col(x, col_centers):
    """Find nearest column for x coordinate."""
    if not col_centers:
        return 0
    dists = [abs(x - c) for c in col_centers]
    return dists.index(min(dists))


def parse_page(page, months_on_page):
    """
    Parse one page and return dict of {(month, day): [(time, height), ...]}
    months_on_page: list of 4 month numbers (1-12) in order left to right
    """
    words = page.extract_words(x_tolerance=2, y_tolerance=2, keep_blank_chars=False)
    if not words:
        return {}
    
    page_width = page.width
    
    col_centers = find_column_centers(words, page_width)
    print(f"  Column centers: {[round(c, 1) for c in col_centers]}", file=sys.stderr)
    
    # Group words by row (y coordinate)
    rows_by_y = defaultdict(list)
    for w in words:
        y = round(w['top'] / 3) * 3
        rows_by_y[y].append(w)
    
    # Sort rows top to bottom
    sorted_rows = sorted(rows_by_y.items())
    
    # Find data start: row after the "1 16 1 16..." pattern or after "Time m" row
    # Skip header rows
    data_start_y = None
    for y, row_words in sorted_rows:
        texts = [w['text'] for w in sorted(row_words, key=lambda w: w['x0'])]
        # Check if this looks like a day-number row
        try:
            nums = [int(t) for t in texts]
            if all(1 <= n <= 31 for n in nums) and len(nums) >= 2:
                data_start_y = y
                break
        except ValueError:
            pass
    
    result = {}  # (month_idx, day) -> list of (time, height)
    
    # Track state per column: current day number, pending time
    col_state = [{} for _ in range(8)]  # Not used now, using simpler approach
    
    # Current day numbers per column (updated when we see a day-number row)
    col_days = [None] * 8
    # Pending times per column (time token waiting for its height)
    col_pending_time = [None] * 8
    
    in_data = False
    
    for y, row_words in sorted_rows:
        if data_start_y is not None and y < data_start_y:
            continue
        
        sorted_words = sorted(row_words, key=lambda w: w['x0'])
        texts = [w['text'] for w in sorted_words]
        text_joined = ' '.join(texts)
        
        # Skip footer/copyright rows
        if any(kw in text_joined for kw in ['Copyright', 'Datum', 'Moon Phase', 'Caution', 'Bureau']):
            continue
        
        # Check if day-number row
        try:
            nums = [int(t) for t in texts]
            if all(1 <= n <= 31 for n in nums) and len(nums) >= 2:
                in_data = True
                # Assign day numbers to columns
                new_col_days = [None] * 8
                for w in sorted_words:
                    try:
                        n = int(w['text'])
                        if 1 <= n <= 31:
                            c = assign_col(w['x0'], col_centers)
                            new_col_days[c] = n
                    except ValueError:
                        pass
                col_days = new_col_days
                col_pending_time = [None] * 8
                continue
        except ValueError:
            pass
        
        if not in_data:
            continue
        
        # Process tide data tokens
        for w in sorted_words:
            txt = w['text']
            c = assign_col(w['x0'], col_centers)
            tok_type, tok_val = parse_token(txt)
            
            if tok_type == 'time':
                col_pending_time[c] = tok_val
            elif tok_type == 'height':
                day = col_days[c]
                if day is not None:
                    month_idx = c // 2
                    if month_idx < len(months_on_page):
                        month = months_on_page[month_idx]
                        key = (month, day)
                        if key not in result:
                            result[key] = []
                        t = col_pending_time[c]
                        if t is not None:
                            result[key].append((t, tok_val))
                            col_pending_time[c] = None
            elif tok_type == 'day':
                pass  # handled in day-number row detection
            elif tok_type == 'dayabbrev':
                pass  # standalone day abbrev, time follows
    
    return result


def assign_tide_types(day_tides):
    """Assign high/low type based on alternating pattern."""
    result = []
    sorted_tides = sorted(day_tides, key=lambda t: t[0])
    n = len(sorted_tides)
    
    for i, (time_str, height) in enumerate(sorted_tides):
        prev_h = sorted_tides[i-1][1] if i > 0 else None
        next_h = sorted_tides[i+1][1] if i < n - 1 else None
        
        if prev_h is None and next_h is not None:
            t = 'high' if height > next_h else 'low'
        elif next_h is None and prev_h is not None:
            t = 'high' if height > prev_h else 'low'
        elif prev_h is not None and next_h is not None:
            if height >= prev_h and height >= next_h:
                t = 'high'
            elif height <= prev_h and height <= next_h:
                t = 'low'
            else:
                # Plateau - check which way we're trending
                t = 'high' if height > (prev_h + next_h) / 2 else 'low'
        else:
            t = 'high' if height > 0.9 else 'low'
        
        result.append({'time': time_str, 'type': t, 'height': height})
    
    return result


def parse_port(port_id, port_name, lat, lng, page_indices):
    all_data = {}  # (month, day) -> [(time, height)]
    
    with pdfplumber.open(r'C:\Users\stuar\Amaroo\2026_queenslandtidetables.pdf') as pdf:
        pages = [pdf.pages[i] for i in page_indices]
        
        for page_num, page in enumerate(pages):
            # Determine months on this page
            months_start = page_num * 4  # 0-indexed months
            months_on_page = list(range(months_start + 1, months_start + 5))  # 1-12
            
            print(f"  Page {page_indices[page_num]+1}, months {months_on_page}", file=sys.stderr)
            
            page_data = parse_page(page, months_on_page)
            for k, v in page_data.items():
                if k not in all_data:
                    all_data[k] = []
                all_data[k].extend(v)
    
    # Build output tides list
    tides = []
    for (month, day), tide_times in sorted(all_data.items()):
        date_str = f"2026-{month:02d}-{day:02d}"
        
        # Remove duplicates
        unique_tides = list(dict.fromkeys([(t, h) for t, h in tide_times]))
        
        typed = assign_tide_types(unique_tides)
        for t in typed:
            tides.append({
                'date': date_str,
                'time': t['time'],
                'type': t['type'],
                'height': t['height'],
            })
    
    print(f"  Total tides: {len(tides)}", file=sys.stderr)
    return tides


def main():
    all_ports = {}
    
    for port_id, port_name, lat, lng, page_indices in PORTS:
        print(f"\nParsing {port_name}...", file=sys.stderr)
        tides = parse_port(port_id, port_name, lat, lng, page_indices)
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
