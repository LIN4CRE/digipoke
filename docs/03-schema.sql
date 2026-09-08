-- =====================================================================
-- DigiPoke — reference relational schema
-- =====================================================================
-- The shipped server uses an atomic JSON store (server/src/store.js) and
-- needs no database. This file exists so that a deployment which outgrows
-- a single node can migrate to PostgreSQL/SQLite without redesigning the
-- model, and so that analysts can reason about the data with SQL.
--
-- Dialect: PostgreSQL 14+ (notes included for SQLite/MySQL variants).
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------
CREATE TYPE element_type AS ENUM (
  'flame','aqua','verdant','volt','terra','aero','frost','byte','virus','null'
);

CREATE TYPE evolution_stage AS ENUM ('rookie','champion','ultimate','mega');

CREATE TYPE status_condition AS ENUM ('burn','poison','paralyze','freeze','sleep');

-- ---------------------------------------------------------------------
-- Static game data (seeded from the client's domain modules)
-- ---------------------------------------------------------------------

CREATE TABLE species (
  id            text PRIMARY KEY,
  name          text        NOT NULL,
  stage         evolution_stage NOT NULL,
  type_primary  element_type NOT NULL,
  type_secondary element_type,
  base_hp       smallint    NOT NULL CHECK (base_hp   BETWEEN 1 AND 255),
  base_atk      smallint    NOT NULL CHECK (base_atk  BETWEEN 1 AND 255),
  base_def      smallint    NOT NULL CHECK (base_def  BETWEEN 1 AND 255),
  base_spd      smallint    NOT NULL CHECK (base_spd  BETWEEN 1 AND 255),
  capture_rate  smallint    NOT NULL CHECK (capture_rate BETWEEN 1 AND 255),
  base_xp       smallint    NOT NULL CHECK (base_xp > 0),
  evolves_to    text        REFERENCES species(id) ON DELETE SET NULL,
  evolve_level  smallint    CHECK (evolve_level BETWEEN 1 AND 50),
  evolve_bond   smallint    CHECK (evolve_bond  BETWEEN 0 AND 100),
  art           jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- procedural sprite descriptor
  lore          text,
  -- An evolution line must be a strict upgrade in total base stats.
  CONSTRAINT evolve_pair CHECK (
    (evolves_to IS NULL) OR (evolve_level IS NOT NULL)
  ),
  CONSTRAINT no_self_evolution CHECK (evolves_to IS NULL OR evolves_to <> id)
);
CREATE INDEX species_stage_idx ON species (stage);
CREATE INDEX species_evolves_idx ON species (evolves_to);

-- Move catalogue. Ids are permanent: deprecate, never rename or delete.
CREATE TABLE moves (
  id       text PRIMARY KEY,
  name     text NOT NULL,
  type     element_type NOT NULL,
  power    smallint NOT NULL DEFAULT 0 CHECK (power BETWEEN 0 AND 255),
  accuracy smallint NOT NULL DEFAULT 100 CHECK (accuracy BETWEEN 0 AND 100),
  pp       smallint NOT NULL DEFAULT 20 CHECK (pp > 0),
  effect   jsonb,                 -- {kind:'status'|'heal'|'stat'|'recoil'|'drain', …}
  description text
);

-- Level-keyed learnsets: which species learns which move, and at what level.
CREATE TABLE species_learnsets (
  species_id text NOT NULL REFERENCES species(id) ON DELETE CASCADE,
  move_id    text NOT NULL REFERENCES moves(id)   ON DELETE CASCADE,
  level      smallint NOT NULL CHECK (level BETWEEN 1 AND 50),
  PRIMARY KEY (species_id, move_id)
);
CREATE INDEX learnset_level_idx ON species_learnsets (species_id, level);

-- Sparse type chart. Missing pairs default to 1.0 (neutral).
CREATE TABLE type_chart (
  attacker element_type NOT NULL,
  defender element_type NOT NULL,
  multiplier numeric(3,2) NOT NULL CHECK (multiplier IN (0, 0.25, 0.5, 1, 2, 4)),
  PRIMARY KEY (attacker, defender)
);

CREATE TABLE zones (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  blurb         text,
  min_level     smallint NOT NULL CHECK (min_level BETWEEN 1 AND 50),
  max_level     smallint NOT NULL CHECK (max_level BETWEEN 1 AND 50),
  recommended   smallint NOT NULL DEFAULT 0,
  accent        text,
  CONSTRAINT level_band CHECK (min_level <= max_level)
);

CREATE TABLE zone_encounters (
  zone_id    text NOT NULL REFERENCES zones(id)    ON DELETE CASCADE,
  species_id text NOT NULL REFERENCES species(id)  ON DELETE CASCADE,
  weight     integer NOT NULL CHECK (weight > 0),
  PRIMARY KEY (zone_id, species_id)
);

-- ---------------------------------------------------------------------
-- Player data (would only exist server-side in a hosted-sync deployment;
-- in the shipped app these rows live in the client's IndexedDB save file)
-- ---------------------------------------------------------------------

CREATE TABLE profiles (
  id            uuid PRIMARY KEY,
  display_name  text NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 18),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  seed          bigint NOT NULL,               -- world RNG seed
  shards        integer NOT NULL DEFAULT 0 CHECK (shards >= 0)
);

CREATE TABLE creatures (
  uid        uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  species_id text NOT NULL REFERENCES species(id),
  nickname   text CHECK (nickname IS NULL OR char_length(nickname) BETWEEN 1 AND 18),
  level      smallint NOT NULL CHECK (level BETWEEN 1 AND 50),
  xp         integer  NOT NULL DEFAULT 0 CHECK (xp >= 0),
  bond       smallint NOT NULL DEFAULT 10 CHECK (bond BETWEEN 0 AND 100),
  hp         integer  NOT NULL CHECK (hp >= 0),
  core_hp    smallint NOT NULL CHECK (core_hp  BETWEEN 0 AND 15),
  core_atk   smallint NOT NULL CHECK (core_atk BETWEEN 0 AND 15),
  core_def   smallint NOT NULL CHECK (core_def BETWEEN 0 AND 15),
  core_spd   smallint NOT NULL CHECK (core_spd BETWEEN 0 AND 15),
  shiny      boolean  NOT NULL DEFAULT false,
  caught_at  timestamptz NOT NULL DEFAULT now(),
  origin_zone text REFERENCES zones(id),
  origin_wild boolean NOT NULL DEFAULT false,
  team_slot  smallint CHECK (team_slot BETWEEN 1 AND 6)
);
CREATE INDEX creatures_profile_idx ON creatures (profile_id);
-- At most one creature per team slot, enforced as a partial unique index.
CREATE UNIQUE INDEX creatures_team_slot_uniq ON creatures (profile_id, team_slot)
  WHERE team_slot IS NOT NULL;

CREATE TABLE creature_moves (
  creature_uid uuid NOT NULL REFERENCES creatures(uid) ON DELETE CASCADE,
  move_id      text NOT NULL REFERENCES moves(id)      ON DELETE CASCADE,
  slot         smallint NOT NULL CHECK (slot BETWEEN 1 AND 4),
  PRIMARY KEY (creature_uid, slot)
);

CREATE TABLE profile_stats (
  profile_id     uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  battles        integer NOT NULL DEFAULT 0,
  battles_won    integer NOT NULL DEFAULT 0,
  captures       integer NOT NULL DEFAULT 0,
  evolutions     integer NOT NULL DEFAULT 0,
  steps          integer NOT NULL DEFAULT 0,
  trainers_beaten integer NOT NULL DEFAULT 0,
  faints         integer NOT NULL DEFAULT 0,
  releases       integer NOT NULL DEFAULT 0
);

CREATE TABLE inventory (
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  item_id    text NOT NULL,          -- dataBall | cipherBall | matrixBall | healPatch | statusPatch
  quantity   integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  PRIMARY KEY (profile_id, item_id)
);

CREATE TABLE dex_entries (
  profile_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  species_id     text NOT NULL REFERENCES species(id)  ON DELETE CASCADE,
  seen           integer NOT NULL DEFAULT 0,
  caught         integer NOT NULL DEFAULT 0,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  first_caught_at timestamptz,
  PRIMARY KEY (profile_id, species_id)
);

CREATE TABLE daily_objectives (
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date_key   date NOT NULL,                    -- 'YYYY-MM-DD' (player-local)
  objective_id text NOT NULL,                  -- battles | captures | evolutions | steps | train
  goal       smallint NOT NULL CHECK (goal > 0),
  progress   smallint NOT NULL DEFAULT 0 CHECK (progress >= 0),
  reward     smallint NOT NULL DEFAULT 0,
  claimed_at timestamptz,
  PRIMARY KEY (profile_id, date_key, objective_id)
);

-- ---------------------------------------------------------------------
-- Sync service tables (this is what the shipped server actually needs)
-- ---------------------------------------------------------------------

CREATE TABLE users (
  id         uuid PRIMARY KEY,
  email      citext NOT NULL UNIQUE,           -- citext enforces case-insensitive uniqueness
  pass_hash  text   NOT NULL,                  -- scrypt$N$r$p$salt$hash
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One opaque, encrypted save per user. `ct` is AES-GCM ciphertext produced in
-- the browser; the server has no key and therefore no ability to read it.
CREATE TABLE vaults (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  alg        text NOT NULL,                    -- 'AES-GCM-256'
  iv         text NOT NULL,                    -- base64, 12 bytes
  ct         text NOT NULL,                    -- base64 ciphertext
  schema_ver smallint NOT NULL DEFAULT 1,
  rev        bigint  NOT NULL DEFAULT 0,       -- monotonic: optimistic concurrency
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ct_size CHECK (octet_length(ct) <= 2 * 1024 * 1024)
);

-- Optional audit trail for security review (no payload contents).
CREATE TABLE auth_events (
  id         bigserial PRIMARY KEY,
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  email_try  text,
  event      text NOT NULL,                    -- register | login | login_failed | delete
  ip         inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_events_recent_idx ON auth_events (created_at DESC);

-- ---------------------------------------------------------------------
-- Useful views
-- ---------------------------------------------------------------------

-- Full effectiveness matrix with neutral pairs materialised.
CREATE VIEW v_type_matrix AS
SELECT a.attacker, d.defender,
       COALESCE(t.multiplier, 1.0) AS multiplier
FROM (SELECT unnest(enum_range(NULL::element_type)) AS attacker) a
CROSS JOIN (SELECT unnest(enum_range(NULL::element_type)) AS defender) d
LEFT JOIN type_chart t ON t.attacker = a.attacker AND t.defender = d.defender;

-- Roster with derived totals, mirroring core/domain/creature.js.
CREATE VIEW v_roster AS
SELECT c.uid, c.profile_id, s.name AS species, s.stage,
       c.level, c.bond, c.hp,
       (floor((2 * s.base_hp  + c.core_hp ) * c.level / 100) + c.level + 10) AS max_hp,
       (floor((2 * s.base_atk + c.core_atk) * c.level / 100) + 5)            AS atk,
       (floor((2 * s.base_def + c.core_def) * c.level / 100) + 5)            AS def,
       (floor((2 * s.base_spd + c.core_spd) * c.level / 100) + 5)            AS spd,
       (c.core_hp + c.core_atk + c.core_def + c.core_spd) AS core_total
FROM creatures c
JOIN species s ON s.id = c.species_id;

COMMIT;

-- =====================================================================
-- Portability notes
-- ---------------------------------------------------------------------
-- SQLite: replace `uuid` with TEXT, `citext` with TEXT COLLATE NOCASE,
--         `jsonb` with TEXT, `timestamptz` with TEXT (ISO-8601),
--         `bigserial` with INTEGER PRIMARY KEY AUTOINCREMENT, and
--         `unnest(enum_range(...))` with an explicit VALUES list.
-- MySQL:  replace `citext` with VARCHAR(160) COLLATE utf8mb4_0900_ai_ci,
--         `jsonb` with JSON, and `inet` with VARCHAR(45).
-- =====================================================================
