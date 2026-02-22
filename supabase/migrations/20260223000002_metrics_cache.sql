-- metrics_cache: High-frequency time-series data from Cloud Run and external services
CREATE TABLE IF NOT EXISTS metrics_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service TEXT NOT NULL,
    metric TEXT NOT NULL,
    value DECIMAL(12,4) NOT NULL,
    labels JSONB DEFAULT '{}',
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_metrics_cache_lookup ON metrics_cache(service, metric, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_cache_timestamp ON metrics_cache(timestamp DESC);
