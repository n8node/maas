-- +goose Up

CREATE TABLE plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    price_monthly_rub INT NOT NULL DEFAULT 0,
    price_yearly_rub INT NOT NULL DEFAULT 0,
    max_instances INT NOT NULL DEFAULT 2,
    monthly_tokens BIGINT NOT NULL DEFAULT 100000,
    max_storage_mb BIGINT NOT NULL DEFAULT 100,
    allowed_memory_types TEXT[] NOT NULL DEFAULT ARRAY['rag']::TEXT[],
    gardener_enabled BOOLEAN NOT NULL DEFAULT false,
    reflective_enabled BOOLEAN NOT NULL DEFAULT false,
    bi_temporal_enabled BOOLEAN NOT NULL DEFAULT false,
    custom_models BOOLEAN NOT NULL DEFAULT false,
    priority_workers BOOLEAN NOT NULL DEFAULT false,
    support_level TEXT NOT NULL DEFAULT 'community',
    is_public BOOLEAN NOT NULL DEFAULT true,
    is_archived BOOLEAN NOT NULL DEFAULT false,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE token_packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    tokens BIGINT NOT NULL,
    price_rub INT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES plans(id),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'canceled', 'past_due', 'paused')),
    current_period_start TIMESTAMPTZ NOT NULL,
    current_period_end TIMESTAMPTZ NOT NULL,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX subscriptions_user_idx ON subscriptions(user_id);
CREATE INDEX subscriptions_user_active_idx ON subscriptions(user_id) WHERE status = 'active';

CREATE UNIQUE INDEX subscriptions_one_active_per_user ON subscriptions(user_id) WHERE (status = 'active');

CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('subscription', 'token_package', 'manual')),
    amount_kopecks INT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'RUB',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
    plan_id UUID REFERENCES plans(id),
    package_id UUID REFERENCES token_packages(id),
    external_id TEXT,
    notes TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX payments_user_idx ON payments(user_id);

CREATE TABLE token_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bucket_type TEXT NOT NULL CHECK (bucket_type IN ('plan', 'purchase')),
    subscription_id UUID REFERENCES subscriptions(id) ON DELETE CASCADE,
    payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
    tokens_total BIGINT NOT NULL,
    tokens_used BIGINT NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT token_balances_positive CHECK (tokens_used <= tokens_total),
    CONSTRAINT token_balances_bucket CHECK (
        (bucket_type = 'plan' AND subscription_id IS NOT NULL AND payment_id IS NULL)
        OR (bucket_type = 'purchase' AND payment_id IS NOT NULL)
    )
);

CREATE INDEX token_balances_user_idx ON token_balances(user_id);
CREATE INDEX token_balances_consume_idx ON token_balances(user_id, bucket_type, created_at);

INSERT INTO plans (name, slug, price_monthly_rub, monthly_tokens, max_instances, sort_order)
VALUES ('Free', 'free', 0, 100000, 2, 0);

INSERT INTO token_packages (name, tokens, price_rub, sort_order)
VALUES ('Starter pack', 500000, 99000, 0);

-- Active subscription + plan bucket for every user without one
INSERT INTO subscriptions (user_id, plan_id, status, current_period_start, current_period_end)
SELECT u.id, p.id, 'active', (now() AT TIME ZONE 'utc'), (now() AT TIME ZONE 'utc') + interval '1 month'
FROM users u
CROSS JOIN plans p
WHERE p.slug = 'free'
AND NOT EXISTS (
    SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.status = 'active'
);

INSERT INTO token_balances (user_id, bucket_type, subscription_id, tokens_total, tokens_used, expires_at)
SELECT s.user_id, 'plan', s.id, pl.monthly_tokens, 0, s.current_period_end
FROM subscriptions s
JOIN plans pl ON pl.id = s.plan_id
WHERE s.status = 'active'
AND NOT EXISTS (
    SELECT 1 FROM token_balances tb WHERE tb.subscription_id = s.id AND tb.bucket_type = 'plan'
);

-- +goose Down
DROP TABLE IF EXISTS token_balances;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS subscriptions;
DROP TABLE IF EXISTS token_packages;
DROP TABLE IF EXISTS plans;
