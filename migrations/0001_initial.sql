CREATE TABLE IF NOT EXISTS reference_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    value TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(category, value)
);

CREATE TABLE IF NOT EXISTS incidents (
    id TEXT PRIMARY KEY,
    batch_number TEXT NOT NULL,
    part_number TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    operator TEXT NOT NULL,
    supplier TEXT NOT NULL,
    buyer TEXT NOT NULL,
    error_type TEXT NOT NULL,
    comment TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('Open', 'Resolved', 'Deleted')) DEFAULT 'Open',
    created_at TEXT NOT NULL,
    resolved_at TEXT,
    deleted_at TEXT,
    deleted_reason TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_incidents_status_created_at ON incidents(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_supplier ON incidents(supplier);
CREATE INDEX IF NOT EXISTS idx_incidents_buyer ON incidents(buyer);
CREATE INDEX IF NOT EXISTS idx_incidents_error_type ON incidents(error_type);

CREATE TABLE IF NOT EXISTS incident_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    FOREIGN KEY (incident_id) REFERENCES incidents(id)
);

CREATE INDEX IF NOT EXISTS idx_incident_events_incident_id ON incident_events(incident_id, created_at DESC);

INSERT OR IGNORE INTO reference_items (category, value) VALUES
    ('operator', 'Maria Lopez'),
    ('operator', 'James Carter'),
    ('operator', 'Linda Park'),
    ('operator', 'Robert Chen'),
    ('supplier', 'AeroTech Supplies'),
    ('supplier', 'Avionics Plus'),
    ('supplier', 'SkyParts Intl'),
    ('supplier', 'Precision Avio'),
    ('supplier', 'FastComp'),
    ('buyer', 'Alice Brown'),
    ('buyer', 'Mark Spencer'),
    ('buyer', 'Sophia Reid'),
    ('buyer', 'David Zhou'),
    ('errorType', 'Wrong documentation'),
    ('errorType', 'Missing documentation'),
    ('errorType', 'Wrong labeling'),
    ('errorType', 'Missing label'),
    ('errorType', 'Quantity discrepancy'),
    ('errorType', 'Wrong part number'),
    ('errorType', 'Damaged material'),
    ('errorType', 'Packaging issue'),
    ('errorType', 'SAP mismatch'),
    ('errorType', 'Other');
