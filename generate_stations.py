"""
Generate src/data/tideStations.js from the parsed tide JSON.
"""
import json
import sys

with open(r'C:\Users\stuar\Amaroo\tide_data_utf8.json', 'r', encoding='utf-8-sig') as f:
    data = json.load(f)

# Build the STANDARD_PORTS export
lines = []
lines.append("// AUTO-GENERATED from 2026 Queensland Tide Tables (MSQ)")
lines.append("// © The State of Queensland (Department of Transport and Main Roads) 2025")
lines.append("")
lines.append("export const STANDARD_PORTS = {")

port_ids = list(data.keys())
for pi, port_id in enumerate(port_ids):
    port = data[port_id]
    is_last = pi == len(port_ids) - 1
    lines.append(f"  '{port_id}': {{")
    lines.append(f"    name: {json.dumps(port['name'])},")
    lines.append(f"    lat: {port['lat']},")
    lines.append(f"    lng: {port['lng']},")
    lines.append(f"    type: 'standard',")
    lines.append(f"    tides: [")
    tides = port['tides']
    for ti, t in enumerate(tides):
        is_last_t = ti == len(tides) - 1
        comma = '' if is_last_t else ','
        lines.append(f"      {{ date: '{t['date']}', time: '{t['time']}', type: '{t['type']}', height: {t['height']} }}{comma}")
    lines.append(f"    ],")
    lines.append(f"  }}{'' if is_last else ','}")

lines.append("}")
lines.append("")

# SECONDARY_PORTS
secondary_ports = """
export const SECONDARY_PORTS = [
  // Brisbane Bar secondary ports — Moreton Bay
  { id: 'tangalooma', name: 'Tangalooma', lat: -27.183, lng: 153.367, standardPort: 'brisbane_bar', hwDiff: { h: 0, m: -23 }, lwDiff: { h: 0, m: -27 }, ratio: 0.90, constant: 0.05 },
  { id: 'redland_bay', name: 'Redland Bay', lat: -27.617, lng: 153.300, standardPort: 'brisbane_bar', hwDiff: { h: 0, m: 30 }, lwDiff: { h: 0, m: 45 }, ratio: 1.09, constant: 0.00 },
  { id: 'victoria_point', name: 'Victoria Point', lat: -27.583, lng: 153.317, standardPort: 'brisbane_bar', hwDiff: { h: 0, m: 14 }, lwDiff: { h: 0, m: 18 }, ratio: 1.04, constant: 0.12 },
  { id: 'toondah_cleveland', name: 'Toondah Harbour (Cleveland)', lat: -27.533, lng: 153.283, standardPort: 'brisbane_bar', hwDiff: { h: 0, m: 13 }, lwDiff: { h: 0, m: 16 }, ratio: 1.02, constant: 0.00 },
  { id: 'dunwich', name: 'Dunwich', lat: -27.500, lng: 153.400, standardPort: 'brisbane_bar', hwDiff: { h: 0, m: 11 }, lwDiff: { h: 0, m: 16 }, ratio: 0.99, constant: 0.00 },
  { id: 'manly', name: 'Manly', lat: -27.450, lng: 153.183, standardPort: 'brisbane_bar', hwDiff: { h: 0, m: 2 }, lwDiff: { h: 0, m: 7 }, ratio: 1.03, constant: 0.00 },
  { id: 'raby_bay', name: 'Raby Bay (Canals Entrance)', lat: -27.500, lng: 153.283, standardPort: 'brisbane_bar', hwDiff: { h: 0, m: 1 }, lwDiff: { h: 0, m: 1 }, ratio: 1.05, constant: 0.00 },
  { id: 'wellington_point', name: 'Wellington Point', lat: -27.467, lng: 153.233, standardPort: 'brisbane_bar', hwDiff: { h: 0, m: -6 }, lwDiff: { h: 0, m: -3 }, ratio: 1.04, constant: 0.00 },
  { id: 'hope_banks', name: 'Hope Banks', lat: -27.433, lng: 153.300, standardPort: 'brisbane_bar', hwDiff: { h: 0, m: -6 }, lwDiff: { h: 0, m: -6 }, ratio: 1.02, constant: 0.00 },
  { id: 'amity_point', name: 'Amity Point', lat: -27.400, lng: 153.433, standardPort: 'brisbane_bar', hwDiff: { h: 0, m: -40 }, lwDiff: { h: 0, m: -54 }, ratio: 0.82, constant: 0.00 },
  { id: 'saint_helena', name: 'Saint Helena (South)', lat: -27.400, lng: 153.217, standardPort: 'brisbane_bar', hwDiff: { h: 0, m: 0 }, lwDiff: { h: 0, m: 0 }, ratio: 1.05, constant: 0.00 },
  { id: 'nudgee_beach', name: 'Nudgee Beach', lat: -27.350, lng: 153.100, standardPort: 'brisbane_bar', hwDiff: { h: 0, m: -3 }, lwDiff: { h: 0, m: -3 }, ratio: 0.98, constant: 0.00 },
  { id: 'cabbage_tree_creek', name: 'Cabbage Tree Creek (Mouth)', lat: -27.333, lng: 153.100, standardPort: 'brisbane_bar', hwDiff: { h: 0, m: 1 }, lwDiff: { h: 0, m: -1 }, ratio: 0.96, constant: 0.00 },
  { id: 'shorncliffe', name: 'Shorncliffe and Sandgate', lat: -27.317, lng: 153.083, standardPort: 'brisbane_bar', hwDiff: { h: 0, m: -6 }, lwDiff: { h: 0, m: -6 }, ratio: 0.99, constant: 0.00 },
  { id: 'woody_point', name: 'Woody Point', lat: -27.267, lng: 153.100, standardPort: 'brisbane_bar', hwDiff: { h: 0, m: 0 }, lwDiff: { h: 0, m: 2 }, ratio: 0.95, constant: 0.00 },
  { id: 'margate', name: 'Margate', lat: -27.250, lng: 153.117, standardPort: 'brisbane_bar', hwDiff: { h: 0, m: 0 }, lwDiff: { h: 0, m: 2 }, ratio: 0.95, constant: 0.00 },
  { id: 'redcliffe', name: 'Redcliffe', lat: -27.233, lng: 153.117, standardPort: 'brisbane_bar', hwDiff: { h: 0, m: 0 }, lwDiff: { h: 0, m: 0 }, ratio: 0.96, constant: 0.00 },
  { id: 'scarborough', name: 'Scarborough Boat Harbour', lat: -27.200, lng: 153.100, standardPort: 'brisbane_bar', hwDiff: { h: 0, m: -7 }, lwDiff: { h: 0, m: -7 }, ratio: 0.95, constant: 0.00 },
  { id: 'newport', name: 'Newport', lat: -27.200, lng: 153.083, standardPort: 'brisbane_bar', hwDiff: { h: 0, m: -6 }, lwDiff: { h: 0, m: -6 }, ratio: 0.98, constant: 0.00 },
  { id: 'bongaree', name: 'Bongaree (Bribie Island)', lat: -27.083, lng: 153.150, standardPort: 'brisbane_bar', hwDiff: { h: 0, m: 0 }, lwDiff: { h: 0, m: -15 }, ratio: 0.86, constant: 0.00 },
  { id: 'beachmere', name: 'Beachmere (Caboolture River)', lat: -27.133, lng: 153.033, standardPort: 'brisbane_bar', hwDiff: { h: 0, m: 6 }, lwDiff: { h: 0, m: 18 }, ratio: 0.96, constant: 0.00 },
  { id: 'woogoompah', name: 'Woogoompah Island', lat: -27.783, lng: 153.400, standardPort: 'brisbane_bar', hwDiff: { h: 0, m: 14 }, lwDiff: { h: 0, m: 2 }, ratio: 0.69, constant: -0.02 },
  { id: 'jacobs_well', name: 'Jacobs Well', lat: -27.783, lng: 153.367, standardPort: 'brisbane_bar', hwDiff: { h: 0, m: 28 }, lwDiff: { h: 0, m: 18 }, ratio: 0.78, constant: -0.10 },
  { id: 'russell_island', name: 'Russell Island (Canaipa Point)', lat: -27.650, lng: 153.417, standardPort: 'brisbane_bar', hwDiff: { h: 0, m: 31 }, lwDiff: { h: 0, m: 42 }, ratio: 1.06, constant: 0.00 },
  { id: 'macleay_island', name: 'Macleay Island (Southern Jetty)', lat: -27.633, lng: 153.367, standardPort: 'brisbane_bar', hwDiff: { h: 0, m: 30 }, lwDiff: { h: 0, m: 42 }, ratio: 1.08, constant: -0.09 },
  { id: 'rocky_point_logan', name: 'Rocky Point (Logan River)', lat: -27.700, lng: 153.350, standardPort: 'brisbane_bar', hwDiff: { h: 0, m: 40 }, lwDiff: { h: 0, m: 55 }, ratio: 0.96, constant: 0.01 },
  { id: 'oak_island', name: 'Oak Island', lat: -27.700, lng: 153.400, standardPort: 'brisbane_bar', hwDiff: { h: 0, m: 15 }, lwDiff: { h: 0, m: -30 }, ratio: 0.79, constant: 0.00 },
  // Gold Coast secondary ports
  { id: 'paradise_point', name: 'Paradise Point', lat: -27.883, lng: 153.400, standardPort: 'gold_coast_seaway', hwDiff: { h: 1, m: 23 }, lwDiff: { h: 1, m: 23 }, ratio: 0.90, constant: 0.00 },
  { id: 'runaway_bay', name: 'Runaway Bay', lat: -27.917, lng: 153.400, standardPort: 'gold_coast_seaway', hwDiff: { h: 0, m: 31 }, lwDiff: { h: 0, m: 52 }, ratio: 0.86, constant: 0.00 },
  { id: 'southport', name: 'Gold Coast Bridge', lat: -27.983, lng: 153.417, standardPort: 'gold_coast_seaway', hwDiff: { h: 0, m: 10 }, lwDiff: { h: 0, m: 20 }, ratio: 0.97, constant: 0.13 },
  // Mooloolaba secondary ports
  { id: 'caloundra_head', name: 'Caloundra Head', lat: -26.800, lng: 153.150, standardPort: 'mooloolaba', hwDiff: { h: 0, m: 0 }, lwDiff: { h: 0, m: 0 }, ratio: 1.00, constant: 0.00 },
  { id: 'parrearra', name: 'Parrearra (Mooloolah River)', lat: -26.717, lng: 153.117, standardPort: 'mooloolaba', hwDiff: { h: 0, m: 23 }, lwDiff: { h: 0, m: 44 }, ratio: 0.94, constant: 0.00 },
  { id: 'noosa_river_mouth', name: 'Noosa River Mouth', lat: -26.383, lng: 153.083, standardPort: 'mooloolaba', hwDiff: { h: 0, m: 6 }, lwDiff: { h: 0, m: 13 }, ratio: 0.79, constant: 0.00 },
  // Noosa Head secondary ports
  { id: 'noosa_beach', name: 'Noosa Beach', lat: -26.383, lng: 153.083, standardPort: 'noosa_head', hwDiff: { h: 0, m: 0 }, lwDiff: { h: 0, m: 0 }, ratio: 1.00, constant: 0.00 },
  { id: 'double_island_point', name: 'Double Island Point', lat: -25.917, lng: 153.183, standardPort: 'noosa_head', hwDiff: { h: 0, m: 0 }, lwDiff: { h: 0, m: 0 }, ratio: 1.00, constant: 0.00 },
  // Urangan secondary ports
  { id: 'kingfisher_bay', name: 'Kingfisher Bay', lat: -25.400, lng: 153.100, standardPort: 'urangan', hwDiff: { h: 0, m: 11 }, lwDiff: { h: 0, m: 18 }, ratio: 1.07, constant: 0.00 },
  { id: 'turkey_island', name: 'Turkey Island', lat: -25.517, lng: 152.933, standardPort: 'urangan', hwDiff: { h: 0, m: 43 }, lwDiff: { h: 0, m: 43 }, ratio: 1.08, constant: 0.00 },
  // Bundaberg secondary ports
  { id: 'tin_can_bay', name: 'Tin Can Bay (Snapper Creek)', lat: -25.900, lng: 153.000, standardPort: 'bundaberg', hwDiff: { h: 0, m: 44 }, lwDiff: { h: 0, m: -16 }, ratio: 0.80, constant: 0.00 },
  { id: 'lady_elliot_island', name: 'Lady Elliot Island', lat: -24.117, lng: 152.717, standardPort: 'bundaberg', hwDiff: { h: 0, m: -24 }, lwDiff: { h: 0, m: -33 }, ratio: 0.74, constant: -0.06 },
  { id: 'bargara', name: 'Bargara', lat: -24.817, lng: 152.450, standardPort: 'bundaberg', hwDiff: { h: 0, m: 0 }, lwDiff: { h: 0, m: 0 }, ratio: 1.00, constant: 0.00 },
]
"""
lines.append(secondary_ports)

output = '\n'.join(lines)
with open(r'C:\Users\stuar\Amaroo\tide_stations_generated.js', 'w', encoding='utf-8') as f:
    f.write(output)

print(f"Written {len(output):,} chars to tide_stations_generated.js")
# Count secondary ports
import re
count = len(re.findall(r"id: '", secondary_ports))
print(f"Secondary ports: {count}")
for port_id, port in data.items():
    print(f"  {port['name']}: {len(port['tides'])} tides")
