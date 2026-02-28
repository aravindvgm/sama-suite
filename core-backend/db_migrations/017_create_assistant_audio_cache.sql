CREATE TABLE assistant_audio_cache (

 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

 organization_id UUID NOT NULL,

 cache_key TEXT NOT NULL,

 question TEXT NOT NULL,

 answer TEXT NOT NULL,

 audio_path TEXT NOT NULL,

 created_at TIMESTAMP NOT NULL DEFAULT NOW(),

 CONSTRAINT fk_audio_cache_org
 FOREIGN KEY (organization_id)
 REFERENCES organizations(id)
);

CREATE UNIQUE INDEX idx_audio_cache_key
ON assistant_audio_cache (organization_id, cache_key);
