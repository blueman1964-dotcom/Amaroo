// Standard shelf life lookup for common provisioning items
// Days are counted from voyage start date (when items are assumed to be provisioned)

const KEYWORD_SHELF_LIVES = [
  // ── Fresh proteins (2 days) ──
  { kw: ['fresh salmon', 'salmon fillet', 'salmon steak', 'raw salmon'], days: 2 },
  { kw: ['fresh tuna', 'raw tuna', 'tuna steak'], days: 2 },
  { kw: ['fresh fish', 'fish fillet', 'barramundi', 'snapper', 'whiting', 'flathead'], days: 2 },
  { kw: ['fresh chicken', 'chicken breast', 'chicken thigh', 'chicken fillet', 'chicken mince', 'raw chicken'], days: 2 },
  { kw: ['chicken wings', 'chicken drumstick'], days: 2 },
  { kw: ['beef mince', 'mince meat', 'minced beef', 'beef steak', 'rump', 'sirloin', 'raw beef'], days: 2 },
  { kw: ['pork mince', 'pork chop', 'pork loin', 'raw pork'], days: 2 },
  { kw: ['fresh prawns', 'raw prawns', 'green prawns', 'tiger prawns'], days: 2 },
  { kw: ['scallop', 'squid', 'octopus', 'crab', 'lobster'], days: 2 },
  // ── 3–5 days ──
  { kw: ['avocado', 'avo'], days: 3 },
  { kw: ['strawberr', 'raspberr', 'blueberr', 'blackberr'], days: 4 },
  { kw: ['mushroom'], days: 4 },
  { kw: ['snow peas', 'sugar snap', 'peas'], days: 5 },
  { kw: ['asparagus'], days: 5 },
  { kw: ['banana', 'bananas'], days: 5 },
  { kw: ['bread', 'sourdough', 'baguette', 'bread roll', 'pita', 'flatbread'], days: 5 },
  { kw: ['wrap', 'tortilla'], days: 14 }, // packaged wraps last longer
  { kw: ['spinach', 'rocket', 'salad leaves', 'mixed leaves', 'mesclun'], days: 5 },
  { kw: ['lettuce', 'iceberg', 'cos lettuce'], days: 7 },
  { kw: ['fresh herbs', 'basil', 'coriander', 'parsley', 'mint', 'dill'], days: 5 },
  // ── 7 days ──
  { kw: ['fresh milk', 'full cream milk', 'skim milk', 'milk', 'oat milk', 'almond milk'], days: 7 },
  { kw: ['fresh cream', 'thickened cream', 'whipping cream', 'pouring cream'], days: 7 },
  { kw: ['sour cream', 'creme fraiche'], days: 7 },
  { kw: ['tomato', 'cherry tomato'], days: 7 },
  { kw: ['capsicum', 'bell pepper'], days: 7 },
  { kw: ['zucchini', 'courgette'], days: 7 },
  { kw: ['cucumber'], days: 7 },
  { kw: ['broccoli', 'broccolini'], days: 7 },
  { kw: ['cauliflower'], days: 7 },
  { kw: ['green beans', 'string beans'], days: 7 },
  { kw: ['corn', 'sweet corn'], days: 5 },
  { kw: ['eggplant', 'aubergine'], days: 7 },
  { kw: ['tofu', 'firm tofu', 'silken tofu'], days: 7 },
  { kw: ['mango'], days: 5 },
  { kw: ['fresh ginger'], days: 21 }, // ginger keeps well
  // ── 10–14 days ──
  { kw: ['yogurt', 'yoghurt', 'greek yogurt', 'greek yoghurt'], days: 10 },
  { kw: ['feta', 'feta cheese'], days: 14 },
  { kw: ['brie', 'camembert', 'soft cheese'], days: 10 },
  { kw: ['cream cheese', 'ricotta', 'cottage cheese', 'quark'], days: 10 },
  { kw: ['salami', 'pepperoni'], days: 14 },
  { kw: ['chorizo', 'kabana'], days: 14 },
  { kw: ['prosciutto', 'pancetta', 'bacon', 'ham', 'deli meat'], days: 7 },
  { kw: ['lemon', 'limes', 'lime'], days: 14 },
  { kw: ['orange', 'mandarin', 'clementine', 'grapefruit'], days: 14 },
  { kw: ['apple', 'apples', 'pear', 'pears'], days: 21 },
  { kw: ['carrot', 'carrots'], days: 14 },
  { kw: ['cabbage', 'wombok', 'red cabbage'], days: 21 },
  { kw: ['celery'], days: 14 },
  { kw: ['leek'], days: 10 },
  // ── 21 days ──
  { kw: ['egg', 'eggs', 'free range egg'], days: 21 },
  { kw: ['butter', 'margarine'], days: 21 },
  { kw: ['cheddar', 'tasty cheese', 'colby', 'gouda', 'edam', 'gruyere', 'swiss cheese'], days: 21 },
  { kw: ['parmesan', 'pecorino', 'romano', 'hard cheese'], days: 30 },
  // ── 30 days ──
  { kw: ['potato', 'potatoes', 'sweet potato', 'kumara'], days: 30 },
  { kw: ['onion', 'onions', 'brown onion', 'red onion', 'white onion', 'shallot'], days: 30 },
  { kw: ['garlic'], days: 30 },
  { kw: ['pumpkin', 'butternut', 'squash'], days: 30 },
  // ── Long life — no alert needed ──
  { kw: ['tinned', 'canned', 'tin of', 'can of'], days: 730 },
  { kw: ['pasta', 'spaghetti', 'penne', 'fettuccine', 'macaroni', 'noodle'], days: 365 },
  { kw: ['rice', 'basmati', 'jasmine rice', 'arborio'], days: 365 },
  { kw: ['oats', 'porridge', 'muesli', 'cereal', 'granola'], days: 365 },
  { kw: ['flour', 'self raising', 'plain flour'], days: 365 },
  { kw: ['sugar', 'brown sugar', 'icing sugar'], days: 365 },
  { kw: ['oil', 'olive oil', 'vegetable oil', 'coconut oil', 'sesame oil'], days: 365 },
  { kw: ['soy sauce', 'fish sauce', 'oyster sauce', 'worcestershire'], days: 365 },
  { kw: ['coconut milk', 'coconut cream'], days: 730 },
  { kw: ['stock', 'chicken stock', 'beef stock', 'vegetable stock', 'broth'], days: 730 },
  { kw: ['curry paste', 'red curry', 'green curry', 'massaman'], days: 365 },
  { kw: ['tomato paste', 'tomato sauce', 'passata', 'crushed tomato'], days: 730 },
  { kw: ['honey', 'maple syrup', 'golden syrup'], days: 730 },
  { kw: ['vinegar', 'balsamic', 'apple cider vinegar'], days: 730 },
  { kw: ['mustard', 'dijon', 'wholegrain mustard'], days: 365 },
  { kw: ['mayonnaise', 'aioli'], days: 365 },
  { kw: ['chilli sauce', 'sriracha', 'tabasco', 'hot sauce'], days: 365 },
  { kw: ['frozen'], days: 90 },
]

const CATEGORY_DEFAULTS = {
  Proteins: 3,
  Vegetables: 7,
  Fruit: 7,
  Dairy: 10,
  'Dry Goods': 365,
  Canned: 730,
  Drinks: 365,
  Condiments: 365,
  Frozen: 90,
  Other: 30,
}

// Long-life categories always win — a frozen item is 90 days regardless of name keywords
const CATEGORY_OVERRIDES = {
  Frozen: 90,
  Canned: 730,
  'Dry Goods': 365,
  Condiments: 365,
  Drinks: 365,
}

export function estimateShelfLifeDays(name, category) {
  if (CATEGORY_OVERRIDES[category] !== undefined) return CATEGORY_OVERRIDES[category]

  const lower = (name || '').toLowerCase()

  // Cryovac / vacuum-packed: extends refrigerated shelf life significantly
  if (lower.includes('cryovac') || lower.includes('vac pack') || lower.includes('vacuum pack') || lower.includes('cryopac')) {
    // Still keyword-match the protein type but multiply shelf life
    for (const { kw, days } of KEYWORD_SHELF_LIVES) {
      if (kw.some((k) => lower.includes(k))) return Math.min(days * 12, 42) // up to 6 weeks
    }
    return 30
  }

  for (const { kw, days } of KEYWORD_SHELF_LIVES) {
    if (kw.some((k) => lower.includes(k))) return days
  }
  return CATEGORY_DEFAULTS[category] || 30
}

export function currentVoyageDay(startDate) {
  if (!startDate) return null
  const start = new Date(startDate)
  start.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const day = Math.floor((today - start) / 86400000) + 1
  return day < 1 ? null : day // null if voyage hasn't started
}

export function daysRemaining(shelfLifeDays, voyageDay) {
  if (shelfLifeDays == null || voyageDay == null) return null
  return shelfLifeDays - voyageDay + 1
}

// Returns null for long-life items, badge object otherwise
export function useByBadge(shelfLifeDays, voyageDay) {
  if (shelfLifeDays == null) return null
  if (shelfLifeDays >= 60) return null // long-life — no badge

  const d = daysRemaining(shelfLifeDays, voyageDay)

  if (voyageDay == null) {
    // Voyage not started yet — show planning info only
    return { text: `Day ${shelfLifeDays}`, cls: 'bg-slate-100 text-slate-500 border-slate-200' }
  }

  if (d === null) return null
  if (d <= 0) return { text: 'Expired', cls: 'bg-red-100 text-red-700 border-red-300' }
  if (d === 1) return { text: 'Use today!', cls: 'bg-red-100 text-red-700 border-red-300' }
  if (d <= 3) return { text: `Use in ${d}d`, cls: 'bg-amber-100 text-amber-700 border-amber-300' }
  return { text: `Day ${shelfLifeDays}`, cls: 'bg-slate-100 text-slate-500 border-slate-200' }
}

export function isPerishable(shelfLifeDays) {
  return shelfLifeDays != null && shelfLifeDays < 60
}

// Keyword-based category inference — used before falling back to AI
const CATEGORY_KEYWORDS = {
  Proteins: ['chicken', 'beef', 'pork', 'lamb', 'veal', 'fish', 'salmon', 'tuna', 'barramundi', 'snapper',
    'prawn', 'shrimp', 'scallop', 'squid', 'crab', 'lobster', 'egg', 'tofu', 'tempeh', 'steak',
    'mince', 'fillet', 'sausage', 'bacon', 'ham', 'salami', 'chorizo', 'prosciutto', 'deli meat'],
  Vegetables: ['carrot', 'potato', 'sweet potato', 'onion', 'garlic', 'tomato', 'lettuce', 'broccoli',
    'cauliflower', 'zucchini', 'capsicum', 'cucumber', 'celery', 'mushroom', 'spinach', 'rocket',
    'peas', 'corn', 'eggplant', 'pumpkin', 'leek', 'cabbage', 'asparagus', 'kale', 'bok choy',
    'broccolini', 'snow peas', 'beans', 'ginger', 'chilli', 'herb', 'parsley', 'coriander', 'basil'],
  Fruit: ['apple', 'banana', 'orange', 'lemon', 'lime', 'mango', 'avocado', 'strawberr', 'grape',
    'pear', 'melon', 'pineapple', 'berr', 'mandarin', 'clementine', 'kiwi', 'passionfruit',
    'peach', 'plum', 'cherry', 'watermelon', 'rockmelon'],
  Dairy: ['milk', 'cheese', 'butter', 'cream', 'yogurt', 'yoghurt', 'margarine', 'ricotta',
    'feta', 'brie', 'camembert', 'parmesan', 'cheddar', 'gouda', 'mozzarella', 'sour cream',
    'creme fraiche', 'cream cheese', 'custard'],
  'Dry Goods': ['rice', 'pasta', 'spaghetti', 'penne', 'fettuccine', 'noodle', 'flour', 'sugar',
    'oats', 'porridge', 'cereal', 'muesli', 'granola', 'bread', 'sourdough', 'baguette',
    'cracker', 'biscuit', 'wrap', 'tortilla', 'pita', 'couscous', 'quinoa', 'lentil', 'chickpea',
    'kidney bean', 'black bean', 'cannellini'],
  Canned: ['tinned', 'canned', 'tin of', 'coconut milk', 'coconut cream', 'tomato paste', 'passata',
    'crushed tomato', 'stock', 'broth', 'sardine', 'anchov'],
  Drinks: ['water', 'juice', 'coffee', 'tea', 'soft drink', 'beer', 'wine', 'spirit', 'cordial',
    'sparkling', 'kombucha', 'sports drink', 'protein shake', 'electrolyte'],
  Condiments: ['sauce', 'oil', 'olive oil', 'sesame oil', 'vinegar', 'balsamic', 'mustard',
    'mayo', 'mayonnaise', 'aioli', 'ketchup', 'soy sauce', 'fish sauce', 'oyster sauce',
    'hoisin', 'teriyaki', 'worcestershire', 'tabasco', 'sriracha', 'hot sauce', 'honey',
    'maple syrup', 'jam', 'vegemite', 'peanut butter', 'curry paste', 'miso', 'tahini',
    'spice', 'cumin', 'paprika', 'oregano', 'cinnamon', 'turmeric', 'salt', 'pepper',
    'stock cube', 'bouillon'],
  Frozen: ['frozen'],
}

export function inferCategory(name) {
  const lower = (name || '').toLowerCase()
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) return cat
  }
  return 'Other'
}
