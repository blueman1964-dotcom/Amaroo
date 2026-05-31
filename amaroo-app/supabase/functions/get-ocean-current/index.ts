import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const STORMGLASS_API_KEY = Deno.env.get('STORMGLASS_API_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const cache = new Map<string, { data: unknown[]; fetchedAt: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_VERSION = 'v2';

function isStormglassQuotaError(status: number, payload: any, responseText: string): boolean {
  if (status !== 402 && status !== 429) return false;
  const text = String(responseText || '').toLowerCase();
  const payloadText = JSON.stringify(payload || {}).toLowerCase();
  return (
    text.includes('quota') ||
    text.includes('limit') ||
    text.includes('credits') ||
    payloadText.includes('quota') ||
    payloadText.includes('limit') ||
    payloadText.includes('credits')
  );
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { lat, lng, forecastHours = 10, startTime } = await req.json();

    if (!lat || !lng) {
      return new Response(JSON.stringify({ error: 'lat and lng required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const safeForecastHours = Math.max(1, Math.min(120, Number(forecastHours) || 10));
    const requestStart = startTime ? new Date(startTime) : new Date();
    if (Number.isNaN(requestStart.getTime())) {
      return new Response(JSON.stringify({ error: 'Invalid startTime' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    requestStart.setMinutes(0, 0, 0);
    const startHourBucket = Math.floor(requestStart.getTime() / CACHE_TTL_MS);
    const cacheKey = `${CACHE_VERSION}_${Math.round(lat * 100) / 100}_${Math.round(lng * 100) / 100}_${startHourBucket}_${safeForecastHours}`;

    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return new Response(JSON.stringify({ data: cached.data, source: 'cache', pointCount: cached.data.length }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!STORMGLASS_API_KEY) {
      return new Response(JSON.stringify({ error: 'STORMGLASS_API_KEY not configured in Edge Function secrets' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const now = requestStart;
    const end = new Date(now.getTime() + safeForecastHours * 3600000);
    const endTime = end.toISOString();

    const url = `https://api.stormglass.io/v2/weather/point?lat=${lat}&lng=${lng}&params=currentSpeed,currentDirection&start=${now.toISOString()}&end=${endTime}`;
    console.log('Fetching Stormglass URL:', url);

    const sgResponse = await fetch(url, {
      headers: { Authorization: STORMGLASS_API_KEY },
      signal: AbortSignal.timeout(30000),
    });

    const responseText = await sgResponse.text();
    let sgData: any;
    try {
      sgData = JSON.parse(responseText);
    } catch {
      return new Response(JSON.stringify({
        error: 'Stormglass returned invalid response',
        detail: responseText.substring(0, 500),
        url,
      }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!sgResponse.ok) {
      const quotaExceeded = isStormglassQuotaError(sgResponse.status, sgData, responseText);
      return new Response(JSON.stringify({
        error: quotaExceeded ? 'Stormglass quota exceeded' : `Stormglass API error: ${sgResponse.status}`,
        code: quotaExceeded ? 'quota_exceeded' : 'stormglass_error',
        providerStatus: sgResponse.status,
        detail: responseText.substring(0, 500),
        url,
      }), {
        status: quotaExceeded ? 429 : 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = (sgData.hours || []).map((hour: any) => {
      // Stormglass returns either a single number or an array of {source, value} objects
      // Handle both formats gracefully
      const extractValue = (field: any): number | null => {
        if (field == null) return null;
        if (typeof field === 'number') return field;
        if (Array.isArray(field)) {
          const vals = field.map((s: any) => s.value).filter((v: any) => v != null);
          return vals.length > 0 ? vals.reduce((a: number, b: number) => a + b, 0) / vals.length : null;
        }
        if (typeof field === 'object') {
          const vals = Object.values(field)
            .map((value: any) => typeof value === 'number' ? value : value?.value)
            .filter((value: any) => value != null && Number.isFinite(Number(value)));
          return vals.length > 0 ? vals.reduce((a: number, b: number) => a + Number(b), 0) / vals.length : null;
        }
        return null;
      };

      const speedMs = extractValue(hour.currentSpeed);
      const dirDeg = extractValue(hour.currentDirection);

      const currentSpeedKn = speedMs != null ? Math.round(speedMs * 1.944 * 100) / 100 : 0;
      const currentDirectionDeg = dirDeg != null ? Math.round(dirDeg * 10) / 10 : 0;

      return {
        timestamp: hour.time,
        currentSpeedKn,
        currentDirectionDeg,
      };
    });

    cache.set(cacheKey, { data, fetchedAt: Date.now() });

    return new Response(JSON.stringify({
      data,
      source: 'stormglass',
      resolution: 'point forecast',
      pointCount: data.length,
      url,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
